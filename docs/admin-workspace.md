# 管理 Web 工作区

当前工作区通过 `xcss-web::components::AdminShell` 的 Rust 子视图组合。`HeaderNavigation` 提供产品导航，`HeaderActions` 提供真实产品动作；空动作不生成虚构功能。页头同时包含语言、主题、退出和账号入口，业务视图放入全宽 `main`。

路由、选中对象、业务请求、数据列表与草稿由产品拥有。公共库不按产品名称查找相邻仓库，也不生成产品业务状态。`AccountPage` 由产品的正常账号路由承载。可编译的完整示例见 [`examples/csr.rs`](../web/xcss-web/examples/csr.rs)。

默认样式使用内容块外观，`html[data-xcss-appearance="custom"]` 可选入产品外观。CSS 令牌、字体和角标适配器来自固定不可变的 `@xcss/web` 归档；Rust 浏览器源码快照由 [`vendor-xcss-web.py`](../scripts/vendor-xcss-web.py) 以明确接收目录分发并记录真实提交与逐文件摘要。

实例名称由 `xcss_web::contracts::valid_instance_name` 检查：上限参数为 1–32，去除 Unicode 首尾空白后的名称必须非空且不超上限；原始内容禁止 ASCII/C1 控制字符。长度按 Rust `chars()` 计算。后端仍须校验；它不承担用户名、路径或文件名规则。

当前构建使用 Rust `tools/web-build` 和 wasm-bindgen，正式资源由 Axum 内嵌。浏览器测试须证明实际 WASM 已执行，不能用旧界面夹具替代。公共行为验证见[Shell](platform-specifications/admin-web-shell.md)，独立构建见[CSR 接入](rust-native-csr.md)。
