# 普通 Rust 函数式视图迁移工具

本工具把 Leptos `view!` 的 authored RSX 源码改成真正的 Rust DOM/组件 builder，不展开 `#[component]`、不重写业务表达式，不用 HTML 字符串或额外的 UI 宏替代原界面。

代码生成直接通过 `#[path]` 复用当前仓库 `web/leptos/vendor/leptos-macro-csr/src/view/` 与 `diagnostics.rs` 的正式实现。这些文件保留原 MIT 许可证与源码记录；没有另一套手写 HTML 解析器。解析使用同版 rstml，默认功能与本轮集成宏一致：仅 `csr`。它依据实际 Cargo host fingerprint；全量 metadata 的 resolve node 会合并 `cfg(erase_components)` 的另一条依赖功能，不能用那个并集代替真实编译配置。工具拒绝启用 `__internal_erase_components` 运行。其他功能集不能未经验证混用。

## 使用

从 xcss 仓库根目录执行：

```sh
cargo test --locked --offline --manifest-path tools/rustify-views/Cargo.toml
cargo run --locked --offline --manifest-path tools/rustify-views/Cargo.toml -- --dry-run ../xocs/web/leptos/src
cargo run --locked --offline --manifest-path tools/rustify-views/Cargo.toml -- --stdout ../xocs/web/leptos/src/lib.rs
cargo run --locked --offline --manifest-path tools/rustify-views/Cargo.toml -- --write ../xocs/web/leptos/src
cargo run --locked --offline --manifest-path tools/rustify-views/Cargo.toml -- --check ../xocs/web/leptos/src
```

默认 dry-run 只在内存中完成转换、解析和统计；`--stdout` 展示一个文件。`--write` 在所有输入转换成功后，逐文件以临时文件和 rename 替换。目录遍历排除 `vendor`、`target`、`pkg`、`dist`、`.git`，拒绝符号链接；因此各产品的 vendored xcss 必须从 canonical xcss 同步，不能靠宽泛遍历碰运气。

写入前先把含未提交业务改动的完整源码复制到 Git 外实验备份目录；不要假设 Git HEAD 包含这些改动。

转换后执行该产品的 `cargo fmt`、WASM `cargo check/build` 和原浏览器回归。工具自身的两个外部 codegen 模块标有 `#[rustfmt::skip]`，防止格式化工具源码时连带改写第三方快照。

## 生成与保真边界

- 调用正式 `render_view(..., view_marker=None, disable_inert_html=true)`，包括静态元素也生成 `.child(...)`、`.attr(...)`、事件、属性、SVG 与组件 props builder。关闭 inert HTML 优化是这次语法选择的实际取舍；产物可能增大，需测 raw/gzip，不能承诺编译或运行变快。
- 使用 `proc_macro2` 的真实源码 byte spans，只替换宏范围。宏外注释/业务代码保留，随后 rustfmt 负责缩进。宏内普通业务/安全注释从真实词法 token 间隙提取，移到新表达式 block 附近；字符串、原始字符串和 URL 不会误认为注释。
- 每一轮都重新解析生成后的源码并取得新 spans，避免引用 quote 生成的虚拟 span。词法递归同时覆盖 opaque Rust 宏内的 `view!`，例如正式 erasure codegen 的 `StaticVec::from(vec![...])` 内嵌套视图；普通 AST visitor 会漏掉这类视图。
- 保留 Rust 业务条件、闭包、回调、`key`、属性和受控字段表达式；使用最终实际 CSR 宏相同的闭包与视图适配实现，使用普通 Rust 的 `vec!` 等标准宏仍属正常源码。
- 不生成热重载 view marker；当前 CSR 开发流程通过 Rust 构建和整页刷新生效。现有 Markdown 内容的 `inner_html` 是独立的安全渲染路径，工具不会把 UI 结构偷偷移到该路径。
- 拒绝不能解析的 RSX、重复属性、重叠范围、超过 128 层嵌套、带 BOM 或 shebang 的输入。源文件有特殊宏定义/语法时应先单文件审查。

6 个原生回归覆盖真实 builders、事件/属性/组件/SVG、递归嵌套、opaque 宏、Unicode spans、宏外/宏内注释和危险解析失败。xocs 全部源码 dry-run 识别 268 个视图宏，随后完整 WASM 类型检查通过；最终还需集成浏览器验证。

初次验证曾将 metadata 功能并集误作实际 erasure 配置，WASM 类型检查及时拒绝该输出。保留了失败阶段源码与日志，显式 `--repair-erasure` 只接受早期生成的 `StaticVec::from(vec![...])` 与 `__as_shared_reactive_fn(...)` 两种形状，分别还原 tuple 和原参数；正常从备份 RSX 转换不需要该恢复操作。对应独立原生回归防止恢复改动业务表达式。
