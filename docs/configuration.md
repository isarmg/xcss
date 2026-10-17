# 选择配置

xcss 的产品接入由 `xcss-product.toml` 声明。产品的业务配置字段、环境变量和部署路径由产品定义；公共库提供解析、来源标记与校验机制。

## 运行形态

| Profile | 使用场景 | 主要必需能力 |
|---|---|---|
| `server-control-plane` | SQLite 持久管理面，Axum 与 Rust/WASM CSR 管理 Web | platform-sqlite、admin-persistent、server-runtime、server-health |
| `server-filesystem` | SQLite 持久管理员与文件根，Axum | platform-sqlite、admin-persistent、server-runtime、server-health、filesystem-root、linux-openat2 |
| `web-csr-admin` | xcss-web Rust/WASM CSR 管理外壳和页面 | 由对应服务端组件选择 |
| `web-embedded-native` | 原生 ESM 管理页面 | 由对应服务端组件选择 |

完整组合、必需/可选能力和平台常量见 [profiles](../profiles/)；清单字段见 [JSON Schema](../schemas/xcss-product.schema.json)。带管理 Web 的服务端声明 `embedded-web` 并提供 `xcss-web-build.json`。

`foundation.version` 和 `foundation.git_rev` 与原生 Cargo 输入保持一致。Web 资源按自身的不可变官方归档版本与锁文件 SHA-512 完整性摘要校验，不为原生库与资源包数字一致而改号。管理员会话时限、Argon2 参数、Cookie 和编译目标来自选定 profile 的公共策略，产品清单只选择支持的组合。

## 产品配置优先级

`xcss::config::resolve` 按“默认值 → JSON 文件 → 明确映射的环境变量 → 显式命令行覆盖”组合配置，后者优先。每层先按产品 Serde 类型校验；`resolve_validated` 在每个完整来源层检查字段的内在约束与跨字段关系，环境变量或命令行中不同字段的同层覆盖，其排列顺序不影响跨字段语义校验，最终配置再验证必需凭据和外部路径等运行前提。

`Loaded.sources` 记录每个有效叶字段的来源。文件与环境 JSON 各最多 1 MiB，覆盖项最多 256，数组整体替换。完整错误语义见[配置、CLI 与日志参考](configuration-cli-logging.md)。

## Web 工作区

当前管理工作区通过 Rust `AdminShell`、`HeaderNavigation`、`HeaderActions` 组合产品视图。`html[data-xcss-appearance="content-blocks"]` 选择默认外观，产品可通过其他明确标识和自己的样式替换。实例名称验证的上限参数为1–32，诊断入口不出现在管理UI。

语言按 URL 参数、保存偏好和浏览器语言选择，支持 `zh-CN` 与 `en`；主题默认跟随系统，用户选择可保存。规则见[语言](admin-web-language.md)与[工作区](admin-workspace.md)。

生产资源通过 Rust `tools/web-build` 构建，并由[内嵌资源](reference/embedded-web.md)与服务端一同交付。资源预算与当前WASM、字体和媒体桶约束以构建器声明及实际清单验证为准，不能沿用旧构建工具的配置API。
