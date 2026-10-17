# 浏览器 Rust 公共库

`web/xcss-web` 提供独立的 `xcss-web` xcss-web CSR 库，包含管理员会话、同源请求、CSRF、取消与超时、响应体边界、错误脱敏、中英文、主题、字体启动、管理外壳、账号设置、通知与原生对话框。它不依赖只支持 Linux AMD64 的服务端 `xcss` crate；Axum 和服务端发布目标保持原有边界。

当前 `main` 已采用集成的精简 xcss-web CSR、普通 Rust 函数式视图及 Rust Web 构建工具，六个产品继续使用 Axum。当前接入见[集成式 CSR 与 Rust 视图](rust-native-csr.md)，验收范围见[验证记录](rust-native-validation.md)。

首次迁移时曾让 `main` 保留 React；后续 Rust 原生改写位于 `feat/rust-native-web`，现已合并主分支。历史过程与跨仓入口见[迁移总览](xcss-web-workspace-migration.md)。

六个服务产品的 UI、状态和 API 调用由各自 `web/xcss-web/src` 实现。CSS、字体及字体许可证继续使用固定版本的 `@xcss/web`，角标绘制保留为独立 DOM 适配器。xcos 保留 HLS 视频引擎的窄接口，xocs 的 Markdown 解析已由 Rust 实现。这些保留的 JavaScript 文件不承担 React 渲染或业务状态。

## 独立构建

每个产品在 `web/xcss-web/vendor/xcss-web` 保存明确的源码快照，Cargo 只读取这个项目内的相对路径。`SOURCE.json` 记录来源仓库、基础提交和实际文件 SHA-256；基础提交本身不代表工作区新增源码已经发布。任何源码差异均以实际哈希为准。

公共组件修改后，在包含这些产品 checkout 的工作区运行：

```sh
python3 scripts/vendor-xcss-web.py
python3 scripts/vendor-xcss-web.py --check
```

可用 `--product xscs` 指定单个产品。脚本只同步明确的 Rust 源、Cargo 清单和许可证；遇到未知文件或符号链接会停止。产品无需此脚本或兄弟 checkout 即可构建。

产品当前使用 `tools/web-build` 中的 Rust CLI，固定 Rust 1.99.0 和 wasm-bindgen 0.2.129；早期迁移保留的 `scripts/build-xcss-web.py` 不再是生产构建入口。当前构建在开始、结束时核对输入，验证 vendored 来源清单，并记录浏览器 Cargo.lock、依赖来源/校验和及生成文件哈希到 `web/pkg/xcss-web-build.json`。产品将这份记录一起嵌入 Axum 资源。

## 验证

```sh
rustup toolchain install 1.99.0 --profile minimal --component rustfmt,clippy --target wasm32-unknown-unknown
cargo +1.99.0 fmt --manifest-path web/xcss-web/Cargo.toml -- --check
cargo +1.99.0 run --locked --manifest-path tools/web-build/Cargo.toml -- check --product-root .
cargo +1.99.0 run --locked --manifest-path tools/web-build/Cargo.toml -- test --product-root .
cargo +1.99.0 run --locked --manifest-path tools/web-build/Cargo.toml -- build --product-root .
```

浏览器验收必须检查实际 `.wasm` 请求以及 Rust 启动后设置的 `html[data-xcss-runtime="xcss-web"]`，继续运行原有行为、安全与无障碍断言。环境变量或 HTML 文件名的变化本身不足以证明已经加载新运行时。

原 npm 包中的 React 组件作为兼容接口保留，避免未参与本次迁移的消费者失效；这些接口不应再被迁移产品的生产入口导入。它们的历史测试不能替代 Rust/WASM 实现的验收。

## Axum 对 WASM 的适配

后端保留 Axum，并对浏览器资源作针对性优化：构建时生成 `.wasm.gz`，运行时按 `Accept-Encoding` 协商，返回 `application/wasm`、`Content-Encoding: gzip` 和 `Vary: Accept-Encoding`。压缩与原始表示使用各自的强 ETag；HEAD、304 及缺失压缩文件回退保留原资源服务语义。HTML 预加载 WASM，让下载提前开始。沿用原有缓存策略，未以文件名猜测是否可永久缓存。

压缩适配只用于静态 WASM，不涉及认证/API 响应。通用实现维护在 `xcss/scripts/xcss-web-assets.rs` 与 `xcss/web/xcss-web-assets.mjs`；`vendor-xcss-web.py --check` 同时验证六个独立仓库中的副本。
