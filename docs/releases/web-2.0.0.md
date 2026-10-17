# xcss Web 2.0.0

共享 Web 包转为 Rust CSR 产品使用的合同、设计变量、CSS、字体来源及类型化浏览器基础模块。移除 React 组件、Vite 插件、HTTP 客户端和旧管理页面 API；不提供兼容入口。生产应用采用 `xcss-web` Rust 源码快照及 Axum 嵌入资源。

公开 npm 包仍为 `@xcss/web`，无运行时 npm 依赖、React/Vite peer 或可执行入口。字体启动行为由 Rust CSR 启动层负责。原始许可和字体来源保留。

Web 使用独立 `web-v2.0.0` 标签和 `xcss-web-2.0.0.tgz`，原生 xcss crate 保持 1.0.0。发布流程检查源码修订、干净工作树、精确标签、构建后公开入口、TypeScript、真实 CSR 的 Chromium/Firefox 行为，以及独立目录安装归档后的同一浏览器套件。发行描述符记录 URL、大小、SHA-256、SHA-512 与工具链/锁摘要，历史发行不覆盖。
