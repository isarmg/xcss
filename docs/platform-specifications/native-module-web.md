# 当前浏览器集成边界

当前管理界面采用 `web-csr-admin`：独立 `xcss-web` WASM crate、纯Rust函数式视图、精简CSR核心与Axum内嵌资源。原生ESM适配不再是另一个管理运行形态，也不发布旧管理员客户端或Vite配置。

保留的浏览器边界包括 wasm-bindgen 生成的JS glue、共享角标DOM绘制，以及产品实际使用的第三方媒体引擎。它们通过窄接口服务真实CSR，不拥有第二套认证或业务状态。

会话、CSRF、请求预算与管理组件由Rust公共库承担。产品只拥有业务视图、DTO与协议；CSP、同源资源及内嵌字节由产品构建和HTTP验收验证。具体接入见[浏览器公共库](../xcss-web.md)与[当前Shell](admin-web-shell.md)。
