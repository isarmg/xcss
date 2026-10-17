# 构建内嵌 Web 与开发热更新

## 正式版资源来自可执行文件

xcss `1.0.0` 的 `xcss::web_assets` 生成资源表、确定性 JSON 清单和 SHA-256 摘要。每个资源先
快照到 Cargo 的 `OUT_DIR`，再通过 `include_bytes!` 编译，保证清单与最终字节一致。产品正式 HTTP
处理器使用编译资源；发行目录携带清单用于核对，不携带另一份 raw Web。字体和许可证同样进入清单。

资源清单格式为 `web-assets-v1`，文件按路径排序，绑定路径、MIME、大小和 SHA-256。摘要只计算
规范的 JSON 字节，不包含 CLI 打印时添加的换行。产品二进制提供无需配置、无业务副作用的
同次 build.rs 导出的资源清单与构建身份。实际产物验收静态核对二进制内的清单、摘要及资源字节，并把二进制 SHA256 绑定到构建收据，发现旧 dist、遗漏和编译后改动。

## 声明构建输入

服务端 component 的 `xcss-product.toml` capabilities 增加 `embedded-web`。产品根目录提供：

```json
{
  "format": 1,
  "web": { "directory": "web", "script": "build", "dist": "dist" },
  "rust": {
    "manifest": "Cargo.toml",
    "package": "example-server",
    "binary": "example-server",
    "source_revision_env": "EXAMPLE_SOURCE_REVISION"
  }
}
```

将示例保存为产品根目录的 `xcss-web-build.json`。字段声明构建输入。路径必须规范、相对且留在仓库中，不得通过 `..`、反斜线或链接
逃逸。输出目录必须与源码目录分开；根 Web 使用 `directory: "."` 时，仍应给它专用输出目录。
选定的 Cargo 软件包同时在 `[dependencies]` 和 `[build-dependencies]` 中声明同一个 `xcss` crate，
固定相同完整修订号和精确版本，再通过 `xcss::web_assets` 模块调用构建与运行时 API。

产品 `build.rs` 中调用 `xcss::web_assets::build::generate(root)`，`root` 优先使用
`XCSS_WEB_DIST`，本地默认使用声明的 dist。runtime 包含
`include!(concat!(env!("OUT_DIR"), "/xcss-web-assets.rs"))` 后调用共同 `response`。
Axum 用 `response.map(axum::body::Body::from)`；Hyper 用
`response.map(http_body_util::Full::new)`。产品挂载在路径前缀下时，先剥离挂载前缀再查资源。

构建时生成 `.wasm.gz` 后，可用 `xcss::web_assets::wasm::response` 包装实际资源查询函数。该公共实现按
`Accept-Encoding` 协商 gzip，为成功和 304 响应保留 `Vary: Accept-Encoding`，使用压缩表示本身的
ETag，并保留 HEAD 和缺少压缩文件时的原资源查询行为。它使用通用 HTTP 类型，Axum 产品无需复制
压缩协商模块。此接口不对 API 响应作动态压缩。

## 使用共同构建入口

在产品根目录使用当前 Rust 构建入口：

```bash
cargo +1.99.0 run --locked --manifest-path tools/web-build/Cargo.toml -- server --product-root . --mode development
cargo +1.99.0 run --locked --manifest-path tools/web-build/Cargo.toml -- server --product-root . --mode release
```

生产构建不要求 npm 安装。正式模式要求干净 Git 工作树和完整源码修订号，执行锁定的 WASM 与前端
资源构建、Linux AMD64 GNU Rust 编译，最后静态核对
实际生成的 binary 内嵌资源与同次编译收据，不启动候选程序。单独 `cargo build` 不能证明 dist 是本次生成的。

产品专用打包器可以把这一步作为子步骤。需要隔离源码归档、离线 vendor、签名或伴随程序的流程，
继续证明其独有合同，再用同一 CLI 的 `verify --binary <path> --dist <path> --receipt <path>` 核对真实 binary。
此接口只证明内嵌 Web 与 dist 字节相同，不能代替源码、状态或部署验证。

## 热更新与正式验收

development 模式使用未绑定源码身份。产品显式选择 `DirectoryAssets::new(absolute_root)` 后，HTTP
请求读取当前目录资源，前端重新构建立即生效。Rust CLI 的 `serve` 按 `web/rust-web.toml` 代理实际产品
API、监听源码并重建页面；`preview` 只提供已构建资源。开发方式不修改正式 binary 的资源身份。

正式模式只选择内嵌提供器，并拒绝开发目录覆盖。选择内嵌提供器验收时，改动 Web 需要重新构建 binary。
这是资源与服务端同一版本的直接结果。不要让缺失目录触发回退，或在 production 读取可编辑 dist。

共享 HTTP 行为包括 GET/HEAD、准确 MIME、`nosniff`、HTML `no-store`、资源 SHA-256 ETag 与 304。
普通资源使用 `no-cache` 重新验证，因为仅凭文件名不能证明名字就是内容 SHA-256。拥有已验证
内容命名空间的产品可明确扩展 immutable 缓存；产品 CSP 仍由产品既有安全边界控制。

## 检查接入结果

```bash
python3 scripts/xcss-conformance.py verify-source --product-root /absolute/product
python3 scripts/xcss-conformance.py verify-web --product-root /absolute/product
```

上述命令从 xcss 仓库运行，验证声明与依赖。正式包还需执行产品的发行树验证和实际 HTTP
资源验收，覆盖 MIME、GET/HEAD、缓存、错路径以及篡改拒绝。源码检查通过不会自动表示发布树已验证。

当前接入只使用本文的单体、内嵌资源和唯一数据格式合同；不通过历史版本号选择另一套构建规则。
