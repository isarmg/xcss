# xcss-web 强类型 HTTP 边界

`web/xcss-web/src/api.rs` 提供 `request_typed<T>`、`request_typed_with_options<T>` 和 `request_typed_validated_with_options<T>`。所有接口复用原来的同源路径解析、CSRF 会话、响应大小/超时预算、AbortSignal、401 失效与错误正文合同。没有第二套 HTTP 客户端。

有严格业务合同的端点应使用 `request_typed_validated_with_options`，先执行既有 `Value` 校验（包括未知键规则、nullable/缺省、页长、精确整数、响应与请求路径/查询绑定），再反序列化 DTO。不能仅依靠 `Deserialize` 替代安全边界：Serde 的 `Option`、默认字段和未知字段策略不等于业务合同。

```rust,ignore
let page: Page = api::request_typed_validated_with_options(
    path, "GET", None, options,
    |wire| contracts::validate(path, wire),
).await?;
```

`encode_json_body(&input)` 显式返回 `Result<Value, ApiError>`，序列化失败为 `body_serialization_failed`，调用者必须处理后再发送，避免 `unwrap_or(Value::Null)` 静默提交空正文。响应类型不匹配为 `invalid_typed_response_shape`，业务 validator 拒绝为 `invalid_response_contract`；产品层将这两类新错误映射为既有 `platform.invalid_response`。旧 transport 的 `invalid_response_shape` 保持原样。无正文响应应使用 `()`，可空对象使用 `Option<T>`。

原有 `request` / Blob 上传接口继续可用。这里没有改变上传内存路径，也没有把 i64/u64 经由 JS Number 往返。带严格运行时校验的路径仍短暂解析 `Value`，成功后 UI 保存结构体，减少字段名字符串散落与整页对象树复制；未声称已经测得运行速度收益。

纯 Rust 单测覆盖大整数、null/空正文、类型错误、语义校验拒绝及自定义序列化错误；不要求运行浏览器。
