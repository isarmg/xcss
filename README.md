# xcss

xcss 是服务端与管理 Web 的公共基础库。`main` 提供服务端 crate `xcss`、浏览器 CSR 框架与组件库 `xcss-web`、Rust Web 构建工具，由具体产品集成使用。六个产品的主分支采用 Rust 函数式视图，继续使用 Axum 后端。

## 项目功能

- 管理员认证、统一错误与数据合同、SQLite 状态校验和运行时生命周期。
- 安全文件操作、秘密封装、结构化日志和持久操作。
- Rust 函数式管理组件、设计令牌、类型化 HTTP 客户端及内嵌 Web 资源构建。

## 适用平台

Rust 与 Web 构建仅支持 Linux x86_64 GNU（glibc）。部署后的管理页面可通过不同操作系统上的浏览器访问。

## 当前 CSR 接入

框架与共享浏览器源码统一位于 `web/xcss-web`，通过 `scripts/vendor-xcss-web.py` 同步为产品内的独立源码快照。各产品保持 Axum 后端，只构建 CSR；普通 Rust DOM builder 可直接使用 rustfmt 和 Clippy。

下游通过 Cargo crate API 接入，当前使用项目内的源码快照；本次更名没有发布新的 crates.io 包。在产品的 `web/xcss-web/Cargo.toml` 中声明：

```toml
[dependencies]
xcss-web = { path = "vendor/xcss-web", default-features = false, features = ["csr"] }
```

视图从 `xcss_web::prelude::*`、`xcss_web::html` 和 `xcss_web::component` 引入能力。内部核心与宏由 facade 的路径依赖解析，产品无需直接依赖它们。

生产前端准备 Rust `1.99.0`、`wasm32-unknown-unknown` target 和 wasm-bindgen CLI `0.2.129`，在产品根目录执行：

```sh
cargo +1.99.0 run --locked --manifest-path tools/web-build/Cargo.toml -- build --product-root .
```

生产前端构建不需要 Node/Vite。浏览器测试仍使用 Node/Playwright；原 npm 包、历史 TSX 和发布流程保留各自的工具要求。详见 [集成式 CSR 与 Rust 视图](docs/rust-native-csr.md)、[类型化 HTTP 合同](docs/xcss-web-typed-http.md)及 [Rust 构建工具](tools/web-build/README.md)。

## xcss-web 来源

`xcss-web` 的内部核心与过程宏基于 Leptos 0.8.19 裁剪、修改并整合；原 MIT 许可证及版权通知保留。完整上游来源、原始清单与修改记录保存在 [核心 README](web/xcss-web/vendor/xcss-web-core/README.md) 和 [宏 README](web/xcss-web/vendor/xcss-web-macro/README.md)，并由逐文件 SHA-256 清单绑定。独立第三方依赖保留真实包名及许可证；本仓库自有共享组件沿用 Apache-2.0。

## 已发布 1.0.0 的接入

本项目通过依赖接入，不单独运行服务。以下示例使用 1.0.0 的不可变发行输入。Rust 消费者在 `Cargo.toml` 固定精确版本与完整发布修订：

```toml
[dependencies]
xcss = { git = "https://github.com/isarmg/xcss.git", rev = "<v1.0.0 对应的完整 40 位 Git 修订>", version = "=1.0.0" }
```

需要管理 Web 的产品安装同版发行包，并提交依赖锁文件：

```sh
npm install --save-exact https://github.com/isarmg/xcss/releases/download/v1.0.0/xcss-web-1.0.0.tgz
```

通过 `xcss::<module>`、`@xcss/web/<module>` 引入能力，在产品根目录维护 `xcss-product.toml`；React/Vite 等 peer 依赖按包内精确版本安装。完成产品构建后，随该产品部署。

## 已发布 npm 包的编译与归档

准备 Rust `1.99.0`、Node `26.7.0`、pnpm `10.34.6`、Python 3 和 C 编译工具链，在仓库根目录执行（`release/npm/` 须为空或尚未创建）：

```sh
python3 scripts/check-xcss.py
cargo build --release --locked
pnpm install --frozen-lockfile --ignore-scripts
python3 scripts/package-artifacts.py release --output release/npm
```

Rust 构建产物位于 `target/release/`，Web 归档位于 `release/npm/`。本地归档用于接入验证；正式消费者使用已发布的固定 Git 修订和发行包，重新编译并部署各自产品。

[详细文档](docs/README.md)
