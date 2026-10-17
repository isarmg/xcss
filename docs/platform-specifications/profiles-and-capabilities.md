# 运行形态（Profile）与能力（Capability）规范

运行形态是 xcss 发布并验证过的有限能力组合。产品的 `xcss-product.toml` 必须为每个组件选择一个
运行形态，并声明该运行形态的全部必选能力；只能追加运行形态明确允许的可选能力。

第一代运行形态是：`server-control-plane`、`server-filesystem`、
`web-csr-admin`、`web-embedded-native`。机器事实源位于 [`profiles/`](../../profiles)。

产品清单不得声明 Argon2 参数、会话超时、Cookie 属性、管理员表名、CSRF 请求头、服务端 Rust 版本、
浏览器构建工具版本或正式服务端编译目标。这些由各自唯一权威定义维护；安全参数与正式服务端目标由运行形态与平台政策决定。产品差异不得进入运行形态名称；
无法用通用运行形态表达的差异属于产品适配器或业务结构。
管理服务端的 Web 使用 `web-csr-admin` 或 `web-embedded-native`，并与相应的服务端组件一起声明。
