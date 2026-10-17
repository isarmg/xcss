# 集成式 CSR 与 Rust 原生视图

本分支把第二轮精简版 Leptos 0.8.19 核心和配套过程宏纳入 `xcss` 源码，统一提供给 xcos、xczs、xocs、xscs、xsos、xszs。六项目保持 Axum API 和静态资源后端，浏览器只构建 CSR。

`xcss` 的 Linux 服务端 crate、`web/leptos` 的 `xcss-web` 浏览器库、精简 Leptos 核心、主机过程宏以及 `tools/web-build` 构建程序保留独立的 Cargo 边界。服务端不会因此引入浏览器渲染器；集中源码管理也不代表把第三方代码改称自主框架。

核心和宏位于 `web/leptos/vendor/{leptos-csr,leptos-macro-csr}`。各自保留 MIT 许可、原发布源、第二轮补丁摘要与逐文件 `SOURCE.json`。共享库和两个框架包作为完整源码快照同步到产品的 `web/leptos/vendor/xcss-web`，产品可独立 checkout 和构建，不需要相邻工作目录或额外 Leptos Git 仓库。

共享库和产品均使用 `default-features = false, features = ["csr"]`，产品根 manifest 同时补丁核心和宏。Cargo 只采用根 manifest 的 `[patch]`，所以不能仅在共享库内部声明补丁后假定所有消费者都会继承。Rust 构建器核对选中包的身份、实际路径、功能和宏/运行时角色，拒绝 SSR、hydration、full 和 server-function 依赖图。

视图源码采用普通 Rust DOM 与组件构建表达式；`#[component]` 仍是 Rust 属性过程宏。事件闭包、信号、Owner、Effect、cleanup、Portal、焦点与异步取消继续使用已集成的 Leptos 实现。普通 Rust 表达式可以直接由 `rustfmt` 和 Clippy 检查，原视图宏的自定义 HTML token 不再出现在业务和共享组件源码中。

迁移工具 `tools/rustify-views` 复用这份框架自己的视图代码生成实现，按源位置替换宏；嵌套视图重新解析，外部注释保留，宏内注释转为邻近 Rust 注释。它使用实际 CSR 宏配置。Cargo metadata 中的条件功能并集不能替代本次主机宏的编译 feature；验证时另核对实际编译记录。

普通 Rust 视图保留实际 DOM builder，而非把完整界面藏入 HTML 字符串。这会改变旧视图宏的静态 inert-template 优化路径；类型检查与浏览器行为回归均需重新执行，最终 raw/gzip 字节应实测，不能假定语法更 Rust 就会更小或更快。固定版本的框架 helper 调用也增加了升级时的源码迁移工作。

生产 Web 构建使用 `tools/web-build` 的 Rust CLI、Cargo 和 wasm-bindgen；资源解析、压缩、哈希、预载、预算、gzip 与资源清单均在 Rust 内执行。Node/Playwright 仍用于浏览器测试，历史 TSX fixture 可保留开发依赖。`wasm-bindgen` 的 JS glue、浏览器 DOM 绑定、现有角标绘制适配器和 xcos 的 HLS 引擎仍是浏览器边界，生产构建不依赖 Node/Vite 执行它们。

集成收益是统一版本和补丁、减少项目间漂移、可独立构建与严格追溯。成本是接管这份 fork 的升级回归、宏与 helper 的兼容性、更多显式 Rust 视图代码，以及 CSR 本来的 WASM 下载和初始化成本。集中存放源码本身不会减少编译器已消除的未引用代码。

验证入口：

```sh
cargo +1.99.0 test --locked --manifest-path tools/web-build/Cargo.toml
cargo +1.99.0 test --locked --manifest-path tools/rustify-views/Cargo.toml
cargo +1.99.0 run --locked --manifest-path tools/rustify-views/Cargo.toml -- --check web/leptos/src
cargo +1.99.0 fmt --manifest-path web/leptos/Cargo.toml -- --check
cargo +1.99.0 clippy --locked --manifest-path web/leptos/Cargo.toml --target wasm32-unknown-unknown -- -D warnings
python3 scripts/vendor-leptos.py --check
```

构建与发布资源合同详见 [Rust 构建工具](../tools/web-build/README.md)。原精简实验报告保留自己的业务基线与测试范围，不能把新 DTO、Markdown 或视图改写混入旧实验百分比。
