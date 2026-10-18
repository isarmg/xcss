# 开始接入 xcss

xcss 的原生服务端、浏览器 CSR 和构建工具分别接入。服务端继续使用 Axum；Web 使用 `xcss-web` 的纯 Rust 函数式视图，只构建 CSR。准备 Linux x86_64 GNU、Rust `1.99.0`、`wasm32-unknown-unknown` target 和 wasm-bindgen CLI `0.2.129`。生产前端构建不要求 Node；浏览器验收按所用 Playwright 工具准备 Node。

## 原生服务端

在产品 `Cargo.toml` 固定 `xcss` 的官方 Git 来源、精确版本和完整 40 位修订，并提交生成的 `Cargo.lock`。选定修订必须实际包含产品使用的 API 和 profile；当前 main 的契约不能套用到旧发行修订。原生依赖的格式见[根 README](../README.md)，历史发行说明只适用于对应不可变发行物。

可用实际公开 API 验证接入：

```rust
use xcss::admin_auth::normalize_administrator_username;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let username = normalize_administrator_username(" Admin.Ops ")?;
    assert_eq!(username, "admin.ops");
    println!("{username}");
    Ok(())
}
```

将示例放入产品 `examples/xcss_identity.rs`，执行 `cargo run --locked --example xcss_identity`，预期输出 `admin.ops`。完整服务仍由产品组合路由、认证存储和生命周期。

## 声明产品形态

产品根目录的 `xcss-product.toml` 中，`foundation.version` 和 `foundation.git_rev` 与原生 Cargo 依赖一致。管理面选择以下组件；文件服务按 [profiles](../profiles/) 选择文件根能力：

```toml
[[components]]
id = "server"
profile = "server-control-plane"
http_adapter = "axum"
web_profile = "web-csr-admin"
capabilities = ["embedded-web", "platform-sqlite", "admin-persistent", "server-runtime", "server-health"]
```

声明 `embedded-web` 后提供实际的 `xcss-web-build.json`，将最终静态资源内嵌 Server。产品业务 DTO、权限和状态机由产品维护，不进入公共库。

## 浏览器与构建

当前消费者通过仓库内的可校验源码快照使用 `xcss-web` crate；这不表示已发布 crates.io 包。来源修订、文件摘要、原始许可证及接入步骤见 [浏览器 Rust 公共库](xcss-web.md)。不再采用 React/Vite 管理 profile，也不提供旧 profile 别名。

`tools/web-build` 同样由 xcss 分发已提交的独立源码快照，产品保留 `SOURCE.json` 并在构建时校验来源及完整库存。同步和独立校验命令见[构建工具说明](../tools/web-build/README.md)，不手工复制后分别维护。

产品 `web/xcss-web/Cargo.toml` 使用公共 API：

```toml
[dependencies]
xcss-web = { path = "vendor/xcss-web", default-features = false, features = ["csr"] }
```

准备工具链后，在产品根目录执行实际生产入口：

```sh
cargo +1.99.0 run --locked --manifest-path tools/web-build/Cargo.toml -- build --product-root .
```

CSS、字体及必要 JavaScript 适配使用固定的公共来源；资源来源不等同于界面运行时。视图与组件 API 见 [集成式 CSR 与 Rust 视图](rust-native-csr.md)。

## 验证接入

在所选 xcss 修订的源码根目录执行：

```sh
python3 scripts/xcss-conformance.py report --product-root /absolute/path/to/product --json
```

来源、Schema、Web 和发行声明分别校验；`release_verified` 只在实际发行清单通过验证时为 true。随后运行产品自身的 Rust 与真实 WASM 浏览器测试，公共库单测不能替代产品验收。
