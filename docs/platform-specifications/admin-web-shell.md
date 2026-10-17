# 当前管理员 Web 运行形态

公共浏览器 crate `xcss-web` 采用 CSR 和普通 Rust 函数式视图。`AdminShell` 接收 `product`、可选 `landing` 和 `ChildrenFn`，拥有登录、会话恢复、退出、主题、语言、通知和跳过导航入口。业务内容与导航状态由产品提供，`HeaderNavigation` 和 `HeaderActions` 将内容挂入共享页头。

认证与 CSRF 仅保存在 WASM 内存。初始恢复会话时显示不透明启动状态；成功后呈现工作区，401 后显示登录。服务端撤销未确认时清除本地授权、保留明确警告与主动重试入口。登录失败清除密码，只呈现固定安全提示和校验后的请求 ID。恢复会话保留当前深链接；`landing` 仅用于显式登录成功后的本地地址。

`Dialog` 使用原生 modal，限制 Tab 循环、支持 Escape，关闭后恢复触发元素焦点。通知最多五条、每条最多 512 字符、使用文本节点，支持主动关闭和定时清理。通知在正常文档流中，不覆盖业务按钮。

样式、完整字体与角标绘制适配器从独立版本的 `@xcss/web` 资源包导入。默认内容块外观可通过 `html[data-xcss-appearance]` 替换；字体启动、认证合同和无障碍要求保持共同边界。`web/xcss-web/startup.js` 配合 Rust 字体等待逻辑，加载失败或 30 秒未完成时显示可见错误和主动重载按钮，不无限重试或伪造 ready。

真实示例见 [`examples/csr.rs`](../../web/xcss-web/examples/csr.rs)。`pnpm test:web` 在 Chromium 和 Firefox 实际编译并执行此 WASM，验证字体、认证、账号、键盘、主题、通知与移动 WCAG AA；像素级角标测试也使用正式构建资源。产品仍须独立验证业务及真实 Axum HTTP、Cookie、TLS 行为。
