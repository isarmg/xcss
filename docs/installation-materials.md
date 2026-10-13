# 当前发行定义材料

产品构建脚本调用 `installation_material::common(identity, schema, profile)`，取得公共 `credentials`、`database` 和 `definitions` 片段。`identity` 是当前发行身份，`schema` 是当前数据库结构身份；只有 `Some("server-control-plane")` 加入公共 platform 元数据，其他数据库使用 `None`。产品补入自己的数据库路径、完整 DDL、业务检查、配置和资源，按发行清单签名这些材料。

公共 SQL、Argon2 参数、用户名及密码策略、身份指纹和秘密封装参数来自运行时同一份定义。每个 SQL 参数明确标注 `source`、`value` 和 `type`；初始化、密码重置和会话撤销的写入必须与安全审计在同一 `BEGIN IMMEDIATE` 事务执行。重置保留管理员身份，增加会话版本并撤销所有已有会话。每条审计语句独立生成事件身份，目标摘要使用规范化用户名的 SHA-256。

`authority_sources` 记录公共定义源文件的 SHA-256；`definitions` 包含完整认证、结构指纹和当前秘密封装格式与验证向量。产品将这些定义材料分别列入发行清单，不把非合同字段放入最终安装合同。公共库没有安装命令、磁盘探测或安装执行器。独立工具只消费签名定义数据并调用成熟密码库。

配置数据类型通过 `configuration_contract::generate<T>()` 导出 Schema 和默认值。产品定义当前语义规则数组，运行时调用 `configuration_contract::validate_rules(rules, value, root, source)`；构建脚本原样导出规则与产品验证向量。规则使用 JSON Pointer 选择字段，未知规则、参数、缺失字段和错误类型直接拒绝，诊断不包含候选配置值。

当前规则包括整数范围和顺序、枚举、SocketAddr、独立监听地址、路径、根命名空间保护、路径关系、URL 和开发 Web 覆盖。根路径定义使用 `base/value/fallback/suffix/encoding`，最多 16 层 fallback；`server_layout::ROOT_RESERVED_DIRECTORIES` 是保护名称的公共来源。外置业务路径可使用绝对地址。`root-state-paths` 保护根命名空间，`path-relation` 明确决定是否允许业务数据位于私有目录下，并保护产品声明的私有文件前缀。真实权限、链接、文件身份及开发资源目录检查仍由使用方执行。

当前会话完整检查预算为 `MAXIMUM_SESSION_CHECK_ROWS`，包括已撤销的保留行；活动会话容量仍由认证策略单独定义。超出完整检查预算必须拒绝相关操作，不能跳过余下行。
