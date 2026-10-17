# 管理 Web 语言

`xcss_web::i18n` 提供 `locale`、`t`、`tf`、`initialize` 与 `switch_language`。语言优先级为受支持的 `?lang=`、保存的偏好、浏览器语言列表，最后回退英文。`en` 和 `zh` 的区域标签归一为 `en`、`zh-CN`；非法标签不接受。

语言偏好使用 `sarmg.admin.language`；存储被拒绝时仍可从 URL 和浏览器偏好启动。切换语言修改当前 URL 的 `lang` 并重新载入，保留路径、其他查询和 hash。会话与密码不写入此偏好。

文本通过 Rust 视图文本节点呈现，插值不能解释为 HTML。产品请求中的协议枚举、标识符和操作值不随界面语言改变。公开行为由 `tests/web/csr.spec.mjs` 的真实 WASM 双浏览器语言/存储断言和 Rust locale 单测验证，业务翻译仍由产品测试负责。
