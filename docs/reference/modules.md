# 模块索引

## 当前组件地图

| 层 | 内部模块或公开子路径 | 一句话用途 |
|---|---|---|
| Rust 安全 | `xcss::admin_auth` | 管理员名、Argon2id、令牌、Cookie、同源和 CSRF 原语 |
| Rust 认证 | `xcss::admin_core` | 账户/会话生命周期、认证、密码计算容量与安全审计机制 |
| Rust HTTP | `xcss::admin_axum` | Axum 管理员 HTTP 挂载、请求校验与响应适配 |
| Rust HTTP | `xcss::admin_hyper` | Hyper 管理员 HTTP 挂载与同等安全适配 |
| Rust 认证存储 | `xcss::admin_sqlite` | 持久管理员和会话的 SQLite 存储与事务 |
| Rust 构建契约 | `xcss::configuration_contract`、`installation_material::common`、`admin_sqlite::installation_contract` | 同源生成配置 Schema、默认值、语义规则、DDL、凭据与操作材料 |
| Rust 布局 | `xcss::server_layout` | 显式绝对 ROOT 的运行路径 |
| Rust 配置 | `xcss::config` | 分层配置、显式环境映射、来源与输入预算 |
| Rust 协议 | `xcss::contracts` | 管理员、状态、发行、备份和错误的严格通信格式 |
| Rust 错误 | `xcss::error` | 有界错误码、请求 ID 和结构化错误响应 |
| Rust 文件安全 | `xcss::fs_safety` | 描述符相对访问、链接拒绝、权限与身份验证 |
| Rust 日志 | `xcss::log` | 结构化事件、脱敏、筛选和有界轮转 |
| Rust 运维 | `xcss::operations` | 公共操作记录、审计与相应数据库机制 |
| Rust 公共数据库 | `xcss::platform_db` | 管理控制面的公共 SQLite 表与结构 |
| Rust 数据身份 | `xcss::schema_identity` | SQLite 规范结构指纹与四分量身份算法 |
| Rust 秘密 | `xcss::secret` | 秘密值的安全类型与处理原语 |
| Rust 秘密封装 | `xcss::secret_envelope` | 当前秘密封装、动态定义运算及构建期格式材料 |
| Rust HTTP 连接 | `xcss::secure_http` | 服务端出站 HTTP 的安全连接机制 |
| Rust CLI | `xcss::server_cli` | 机器错误、就绪身份核验和共同 HTTP 解析拒绝 |
| Rust 生命周期 | `xcss::server_runtime` | 服务启动、关闭、健康和就绪状态 |
| Rust 平台 | `xcss::server_target` | 目标常量；整个 crate 的 Linux AMD64 GNU 门禁位于根入口 |
| Rust SQLite | `xcss::sqlite` | SQLx 连接、PRAGMA、诊断、身份适配与只读校验副本 |
| Rust 状态文件 | `xcss::state_file` | 私有状态文件、稳定身份检查与运行实例锁 |
| Rust 测试 | `xcss::testkit` | 供测试使用的公共安全夹具与辅助机制 |
| Rust Web 资源 | `xcss::web_assets` | 确定性内嵌清单、SHA-256、HTTP 与开发目录提供器 |
| Web 合同 | `@xcss/web/contracts` | TypeScript 类型、运行时校验、JSON Schema 和夹具 |
| Rust 浏览器 | `xcss_web::{api,components,i18n,theme}` | 独立 WASM CSR、认证、管理外壳与纯 Rust 函数式视图 |
| Web 样式 | `@xcss/web/design-tokens`、`admin-ui/*.css` | 限定作用域的设计、表单、内容块及可访问性资源 |
| Web 字体 | `@xcss/web/web-fonts` | 完整字体、样式、来源元数据和原许可证 |
| Web 角标 | `@xcss/web/admin-ui/server-corners` | 显式启动和清理的窄 DOM 绘制适配器 |
| Rust Web 构建 | `tools/web-build` | 固定 Rust/wasm-bindgen、独立源码快照与发行输入核验 |
| 发布 | Python tools/scripts | 软件包归档、状态/发行身份、release-tree 和工作流校验 |

服务端 `xcss` 与浏览器 `xcss-web` 是独立 Cargo package；Web 资源由独立版本的 `@xcss/web` 单包分发，内部资源模块不独立发布。

## 目录逐层解释

```text
Cargo.toml           服务端 Rust package xcss 的身份、外部依赖与 lint
src/lib.rs           全 crate Linux AMD64 GNU 编译门禁与公开模块
src/<module>/        服务端内部实现、fixture、单元测试
web/xcss-web/        独立 WASM crate、内部核心及过程宏源码快照

package.json         唯一 @xcss/web 包的 exports、engine 和 platform 约束
web/<module>/
├─ src/              TypeScript 源码
├─ test/             从根 dist/<module> 导入的测试
├─ scripts/          内部资源复制步骤
└─ schemas/fixtures/ contracts 的公开机器合同

dist/<module>/       根构建生成的统一输出，不是源码事实源

scripts/             用户/CI调用的稳定命令入口
tools/               policy/release/package的实现和负例
docs/                任务指南、开发说明与专题参考
```

为什么没有 `clients/`？因为 npm 软件包是被产品构建消费的库，不是本仓运行的产品客户端。为什么没有
`config/` 和 `deploy/`？因为 xcss 没有守护进程、systemd或运行配置。
