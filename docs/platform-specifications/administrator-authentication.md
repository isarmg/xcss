# 管理员认证与安装契约

公共权威实现位于 `src/admin_auth/mod.rs`、`src/admin_core/mod.rs`、
`src/admin_sqlite/mod.rs`。当前认证策略为 `AdministratorPolicy`，修订号为 2；
产品使用公共 Service 和 HTTP 适配器，不维护额外策略或旧接口。

## 登录尝试次数

计数对象是当前进程内管理员主 SQLite 数据库的物理设备号及 inode。
同一文件的池、Store 或 Service 重建共享计数，不通过用户名、访客地址、代理头或请求标识建立计数对象。
独立数据库分别计数。内存数据库按池身份隔离，只用于明确的进程内场景。

每个对象从第一次获准尝试开始，按单调时钟统计 60 秒固定窗口，最多允许 60 次登录尝试。
HTTP 适配器先验证请求来源、正文与当前输入契约；进入 Core 后，在账户查询及密码运算前计入一次。
计入获准的成功、错误凭据、无效候选身份和后续存储或 CPU 容量失败；不把达到上限的拒绝继续计入。
成功登录不清零，修改候选用户名不建立新窗口，重复拒绝不延长窗口。
窗口到期后下一次尝试重新计数；进程重启清除进程内计数，不修改数据库。

达到上限时返回 HTTP 429、`auth.login_attempts_exceeded`、`retryable: true`，
`Retry-After` 及 `details.retry_after` 均为窗口剩余秒数向上取整。
错误密码返回 401 `auth.invalid_credentials`，成功返回 200。
调用方等待指定时间后可以重试，不需要更换地址、用户名或重启服务。

注册表最多保留 256 个数据库对象，仅回收所有者已释放、没有使用者且窗口已结束的对象。
容量不足或状态不可用返回 503 `auth.capacity_unavailable`，不合并对象或绕过限制。
密码运算另共享全进程两个 Argon2 槽位，获取槽位最多等待两秒；多个对象不会增加 CPU 并发预算。
请求正文、会话数量及生存时间继续采用 `admin_core` 中的当前有界参数。

## 构建期材料

`admin_auth::credential_policy()` 从实际密码、用户名和令牌常量生成 JSON。
`admin_auth::credential_validation_vectors()` 使用同一校验和密码算法生成公开的确定性校验样例；
其中固定盐只用于公开样例，创建管理员必须使用操作系统随机盐。

`admin_sqlite::installation_contract()` 返回 `common-administrator-installation-v1` JSON，包含策略、校验样例、
当前公共 DDL、元数据结构与指纹算法、初始化、密码重置、会话撤销和审计 SQL 及参数顺序。
运行时 Store 与生成器引用同一 SQL 常量，不维护第二份 SQL 或密码参数。
产品在构建时加入自身配置、业务 DDL、源码与发行身份，并将材料及摘要纳入签名载荷。

独立安装工具读取这些签名数据，用成熟密码库执行当前参数，不需要链接 xcss 或业务 Server。
生成接口不执行安装或提供 Server 维护命令。初始化仅用于新目录及空管理员表；
密码重置保留账户身份，递增会话版本，撤销该账户全部会话，并与审计写入在同一事务中提交。
结构、参数或必要材料不符时拒绝写入，不转换历史数据。

`secret_envelope::envelope_contract()` 同源导出当前封装头、KDF、cipher、AAD、容量及独立校验样例；产品加入自己的 domain/revision/binding。
