# xcss 文档

xcss 为服务端和管理 Web 提供公共 Rust crate 与 npm 包。产品在构建时接入，部署后独立运行。

## 接入和使用

- [开始接入](getting-started.md)：依赖、最小示例和产品清单
- [选择配置](configuration.md)：运行形态、能力、配置优先级和 Web 默认值
- [组合公共模块](usage.md)：认证、配置、数据、管理页面和日志
- [构建内嵌 Web](reference/embedded-web.md)：统一构建、热更新与实际资源检查
- [排查问题](troubleshooting.md)：构建、来源、认证和数据库故障

## 开发和维护

- [构建与测试](development.md)
- [改动工作流](project-workflow.md)
- [发行工具操作](operations.md)
- [功能索引](feature-inventory-and-tradeoffs.md)与[专题参考](reference/README.md)
- [开发者导读](beginner-guide/README.md)
- [架构决策](architecture/README.md)与 [当前 1.0.0 发布说明](releases/1.0.0.md)

Rust 与 Web 构建目标为 Linux x86_64 GNU；部署后的浏览器页面可跨平台访问。代码采用 [Apache License 2.0](../LICENSE)。

- [xcss-web 浏览器公共库与独立构建](xcss-web.md)
- [七仓库 React 到 xcss-web 迁移总览与分支约定](xcss-web-workspace-migration.md)
- [集成式 CSR、纯 Rust 视图与生产构建](rust-native-csr.md)
- [类型化 HTTP 请求与响应合同](xcss-web-typed-http.md)
- [Rust 原生迁移验证与实测体积](rust-native-validation.md)
