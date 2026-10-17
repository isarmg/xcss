# Rust 浏览器 HTTP 与认证生命周期

当前实现位于 [`web/xcss-web/src/api.rs`](../../web/xcss-web/src/api.rs)，通过 `xcss_web::api` 使用；协议结构见 `xcss_web::contracts`。公共 npm 资源包保留类型、校验器与 Schema，但不发布请求客户端或认证状态实现。

## 请求边界

`request`、`request_typed` 和 `request_typed_validated_with_options` 只接受解析后仍同源、路径以 `/api/v1/` 开头的 HTTP(S) 地址，拒绝控制字符、fragment 和用户信息。浏览器凭据固定同源、缓存关闭、重定向拒绝。修改请求由当前内存会话注入 CSRF，调用者不能覆盖安全头。

`RequestOptions` 支持取消信号、超时、响应大小上限和普通请求头。默认超时 10 秒，成功响应默认 2 MiB、可设上限 64 MiB，错误正文固定上限 64 KiB。先检查 Content-Length，再流式累计实际字节；超限取消读取。成功与错误响应验证 JSON 类型、正文及严格错误合同，204 等空响应表示为 JSON null。

`ApiError` 提供状态、稳定错误码、校验后的请求 ID、是否可重试及 Retry-After。界面使用固定安全提示和请求 ID，不能展示服务端原始 message、HTML 或堆栈。每次调用只发送一次；未知副作用由产品通过操作 ID 或幂等协议确认后再决定重试。

## 认证状态

`login`、`restore`、`logout` 与 `update_account` 共享内存会话，修改操作通过互斥锁串行，generation 阻止过期回复发布授权。并发 restore 复用同一 future。`snapshot` 提供 Loading、Anonymous、Authenticated、LogoutUnconfirmed 与 Error；`AUTH_CHANGE_EVENT` 通知共享 UI 更新。

退出立即终止本地授权。退出进行中或撤销未确认时，`restore` 返回 `auth_logout_unconfirmed`，不会读取仍有效的 Cookie 或重新打开受保护内容；只有明确登录成功或确认退出后才解除此限制。服务端撤销未确认时保留撤销所需内存 token 和明确的主动重试入口；确认注销或明确会话失效后清除。刷新页面通过 HttpOnly Cookie 恢复，前端不把 token/会话写入 localStorage、sessionStorage 或 IndexedDB。

## 验证

`cargo +1.99.0 test --locked --manifest-path web/xcss-web/Cargo.toml` 验证解析、边界和当前协议。`pnpm test:web` 编译独立 Rust 示例，在 Chromium 和 Firefox 通过真实网络边界控制回复，验证恢复、登录、账号、退出和 UI 安全行为。实际 Cookie、数据库撤销、TLS 与产品请求协议由各产品集成测试验证。
