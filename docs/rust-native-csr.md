# 集成式 CSR 与 Rust 原生视图

`main` 中的 `xcss-web` 统一向 xcos、xczs、xocs、xscs、xsos、xszs 提供浏览器框架与公共组件。六项目使用 Axum API 和静态资源后端，浏览器只构建 CSR。

`xcss` 的 Linux 服务端 crate、`web/xcss-web` 的公开浏览器 crate、内部核心、主机过程宏以及 `tools/web-build` 构建程序保留独立的 Cargo 边界。来源和许可见[仓库 README](../README.md#xcss-web-来源)。

核心和宏位于 `web/xcss-web/vendor/{xcss-web-core,xcss-web-macro}`。各自的 `SOURCE.json` 校验完整文件集，其中包含 README 和许可证。公开 crate 和两个内部 crate 作为完整源码快照同步到产品的 `web/xcss-web/vendor/xcss-web`，产品可独立 checkout 和构建。

产品仅声明 `xcss-web = { path = "vendor/xcss-web", default-features = false, features = ["csr"] }`。公开 crate 通过路径依赖连接内部核心与宏，公开 Rust 路径为 `xcss_web`；无需依赖注册表中的框架包或设置覆盖补丁。Rust 构建器核对唯一公开 crate、内部包身份、实际路径、功能和宏/运行时角色，拒绝 SSR、hydration、full 和 server-function 依赖图。

视图源码采用普通 Rust DOM 与组件构建表达式；`#[component]` 仍是 Rust 属性过程宏。事件闭包、信号、Owner、Effect、cleanup、Portal、焦点与异步取消继续使用已集成的 xcss-web 实现。普通 Rust 表达式可以直接由 `rustfmt` 和 Clippy 检查，原视图宏的自定义 HTML token 不再出现在业务和共享组件源码中。

一次性视图转换已完成，对应转换器及独立锁文件已退役，历史实现保留在 Git 中。当前视图直接维护为普通 Rust 表达式，使用实际 CSR 宏配置；Cargo metadata 中的条件功能并集不能替代主机过程宏的实际编译 feature。

普通 Rust 视图保留实际 DOM builder，而非把完整界面藏入 HTML 字符串。这会改变旧视图宏的静态 inert-template 优化路径；类型检查与浏览器行为回归均需重新执行，最终 raw/gzip 字节应实测，不能假定语法更 Rust 就会更小或更快。固定版本的框架 helper 调用也增加了升级时的源码迁移工作。

生产 Web 构建使用 `tools/web-build` 的 Rust CLI、Cargo 和 wasm-bindgen；资源解析、压缩、哈希、预载、预算、gzip 与资源清单均在 Rust 内执行。Node/Playwright 仍用于真实浏览器测试，未被六产品调用的资源接口保留 TypeScript；旧界面夹具与其构建依赖已退役。共享圆角的几何、SVG 绘制和 DOM 生命周期由 `xcss_web::server_corners` 实现；六产品通过 `mount_server` 接入，xocs 公开页与管理页均使用该 Rust 实现。`wasm-bindgen` 的 JS glue、启动失败提示和 xcos 的 HLS 引擎保留，生产构建不依赖 Node/Vite 执行它们。

集成收益是统一版本和补丁、减少项目间漂移、可独立构建与严格追溯。成本是接管这份 fork 的升级回归、宏与 helper 的兼容性、更多显式 Rust 视图代码，以及 CSR 本来的 WASM 下载和初始化成本。集中存放源码本身不会减少编译器已消除的未引用代码。

验证入口：

```sh
cargo +1.99.0 test --locked --manifest-path tools/web-build/Cargo.toml
cargo +1.99.0 fmt --manifest-path web/xcss-web/Cargo.toml -- --check
cargo +1.99.0 clippy --locked --manifest-path web/xcss-web/Cargo.toml --target wasm32-unknown-unknown -- -D warnings
python3 scripts/vendor-xcss-web.py --check --destination /absolute/consumer/web/xcss-web/vendor/xcss-web
```

构建与发布资源合同详见 [Rust 构建工具](../tools/web-build/README.md)。原精简实验报告保留自己的业务基线与测试范围，不能把新 DTO、Markdown 或视图改写混入旧实验百分比。

本轮产物、实际回归范围与语法改写体积对照见 [迁移验证记录](rust-native-validation.md)。
