# 浏览器 Rust 公共库

`web/leptos` 提供独立的 `xcss-web` Leptos CSR 库，包含管理员会话、同源请求、CSRF、取消与超时、响应体边界、错误脱敏、中英文、主题、字体启动、管理外壳、账号设置、通知与原生对话框。它不依赖只支持 Linux AMD64 的服务端 `xcss` crate；Axum 和服务端发布目标保持原有边界。

分支约定：`main` 保留现有 React 公共组件方案；新的 Leptos 公共库、同步工具与 WASM 资源适配保存在 `feat/leptos-migration`。六个产品使用同名迁移分支，跨仓说明见[迁移总览](leptos-workspace-migration.md)。

六个服务产品的 UI、状态和 API 调用由各自 `web/leptos/src` 实现。CSS、字体及字体许可证继续使用固定版本的 `@xcss/web`，角标绘制保留为独立 DOM 适配器。视频和 Markdown 等浏览器生态库按产品需要保留窄接口。这些 JavaScript 文件不承担 React 渲染或业务状态。

## 独立构建

每个产品在 `web/leptos/vendor/xcss-web` 保存明确的源码快照，Cargo 只读取这个项目内的相对路径。`SOURCE.json` 记录来源仓库、基础提交和实际文件 SHA-256；基础提交本身不代表工作区新增源码已经发布。任何源码差异均以实际哈希为准。

公共组件修改后，在包含这些产品 checkout 的工作区运行：

```sh
python3 scripts/vendor-leptos.py
python3 scripts/vendor-leptos.py --check
```

可用 `--product xscs` 指定单个产品。脚本只同步明确的 Rust 源、Cargo 清单和许可证；遇到未知文件或符号链接会停止。产品无需此脚本或兄弟 checkout 即可构建。

产品中的 `scripts/build-leptos.py` 来自公共同名脚本，固定 Rust 1.99.0 和 wasm-bindgen 0.2.129。构建在开始、结束时核对输入，验证 vendored 来源清单，并记录浏览器 Cargo.lock、依赖来源/校验和及生成文件哈希到 `web/pkg/leptos-build.json`。产品将这份记录一起嵌入 Axum 资源。

## 验证

```sh
rustup toolchain install 1.99.0 --profile minimal --component rustfmt,clippy --target wasm32-unknown-unknown
cargo +1.99.0 fmt --manifest-path web/leptos/Cargo.toml -- --check
cargo +1.99.0 check --manifest-path web/leptos/Cargo.toml --target wasm32-unknown-unknown --locked
cargo +1.99.0 test --manifest-path web/leptos/Cargo.toml --locked
python3 -I -B scripts/test-leptos-build.py
```

浏览器验收必须检查实际 `.wasm` 请求以及 Rust 启动后设置的 `html[data-xcss-runtime="leptos"]`，继续运行原有行为、安全与无障碍断言。环境变量或 HTML 文件名的变化本身不足以证明已经加载新运行时。

原 npm 包中的 React 组件作为兼容接口保留，避免未参与本次迁移的消费者失效；这些接口不应再被迁移产品的生产入口导入。它们的历史测试不能替代 Rust/WASM 实现的验收。

## Axum 对 WASM 的适配

后端保留 Axum，并对浏览器资源作针对性优化：构建时生成 `.wasm.gz`，运行时按 `Accept-Encoding` 协商，返回 `application/wasm`、`Content-Encoding: gzip` 和 `Vary: Accept-Encoding`。压缩与原始表示使用各自的强 ETag；HEAD、304 及缺失压缩文件回退保留原资源服务语义。HTML 预加载 WASM，让下载提前开始。沿用原有缓存策略，未以文件名猜测是否可永久缓存。

压缩适配只用于静态 WASM，不涉及认证/API 响应。通用实现维护在 `xcss/scripts/leptos-assets.rs` 与 `xcss/web/leptos-assets.mjs`；`vendor-leptos.py --check` 同时验证六个独立仓库中的副本。
