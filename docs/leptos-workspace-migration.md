# React 到 Leptos 迁移维护说明

迁移范围为 `xcos`、`xczs`、`xocs`、`xscs`、`xsos`、`xszs` 六个产品界面，以及公共 `xcss` 浏览器组件。产品后端继续使用 Axum，既有 API、数据库、认证和嵌入静态资源的发布方式保持兼容。

2026-10-17，后续 Rust 原生改写已合并到八个相关仓库的 `main`：六个产品使用 xcss 统一分发的精简 Leptos CSR、普通 Rust 函数式视图及 Rust 生产前端构建；xssi 主分支包含相应前端来源与发布校验支持。本次合并不包含正式发行或线上部署。当前实现与验收见[集成式 CSR 与 Rust 视图](rust-native-csr.md)及[验证记录](rust-native-validation.md)。

当前产品构建与测试入口：

| 产品 | main 维护文档 |
| --- | --- |
| xcos | [Rust 原生 Web 构建与测试](https://github.com/isarmg/xcos/blob/main/docs/rust-native-web.md) |
| xczs | [Rust 原生 Web 构建与测试](https://github.com/isarmg/xczs/blob/main/docs/rust-native-web.md) |
| xocs | [Rust 原生 Web 构建与测试](https://github.com/isarmg/xocs/blob/main/docs/rust-native-web.md) |
| xscs | [Rust 原生 Web 构建与测试](https://github.com/isarmg/xscs/blob/main/docs/rust-native-web.md) |
| xsos | [Rust 原生 Web 构建与测试](https://github.com/isarmg/xsos/blob/main/docs/rust-native-web.md) |
| xszs | [Rust 原生 Web 构建与测试](https://github.com/isarmg/xszs/blob/main/docs/rust-native-web.md) |

以下保留 2026-10-16 首次 Leptos 迁移的流程、分支安排和验收数据；其中 Node/Vite 构建命令描述当时实现，当前生产前端使用上述 Rust 构建入口。

## 历史分支安排

首次迁移时，七个仓库分别使用 `feat/leptos-migration` 保存实现，当时的 `main` 保留 React 方案，验收 checkout 位于迁移分支。`xscs` 的迁移起点为已有 `feat/management-prep`，保留其五个管理与原生集成准备提交；其余仓库从当时的 `main` 建立迁移分支。

以下构建和验证命令针对当时的迁移分支，在多仓工作区运行的示例以这些仓库的共同父目录为起点。当时的分支提交与推送不包含合并到 `main`、创建发行标签或部署。

## 实现边界

各产品的 `web/leptos/src` 负责界面、响应式状态、路由、请求和契约校验，通过 Leptos CSR 编译为独立 WASM。少量 JavaScript 负责字体与 CSS 引导、WASM 加载，以及媒体播放、Markdown 净化等现有浏览器库适配。

公共 Rust 浏览器组件位于 `xcss/web/leptos`；每个产品以 `web/leptos/vendor/xcss-web` 保存可独立构建的快照，不依赖相邻仓库路径。`SOURCE.json` 记录源文件哈希。同步方法：

```sh
python3 xcss/scripts/vendor-leptos.py
python3 xcss/scripts/vendor-leptos.py --check
```

公共 npm 包 `@xcss/web` 仍固定为现有发布版本，提供原有 CSS、字体、许可证和构建接口。它保留兼容其他消费者的 React 导出；六个已迁移产品的生产界面不再导入 React。旧实现归档在各产品的 `web/tests/fixtures`，具体布局见产品维护文档；这些对照文件不进入生产产物，也不作为 Rust 迁移已通过的证据。

## 构建和追溯

固定 Rust 1.99.0、Leptos 0.8.19、wasm-bindgen 0.2.129；Node 版本遵循各仓库 `.node-version`。先安装 wasm32-unknown-unknown target 和同版本 wasm-bindgen-cli。`xczs` 在仓库根目录执行 `npm ci`、`npm run build:platform`；其余五个产品执行 `npm ci --prefix web`、`npm run build --prefix web`。后续 Axum 打包流程继续读取 `web/dist`。

`web/pkg/leptos-build.json` 及发布资源 `assets/leptos-build.json` 记录 Cargo 锁定依赖、源码与公共快照、构建工具和产物 SHA-256。构建脚本拒绝不一致快照、符号链接和编译期间变动的输入。

## 收益和成本

前端业务与后端可使用同一种语言，公共认证、请求约束和组件可由 Rust 复用；浏览器直接使用类型和状态约束，避免并行维护 React 运行时与业务 TypeScript。Axum 保留现有服务边界，迁移不要求改成全栈 SSR。

各产品仍通过 HTTP/JSON 与后端通信，跨仓库 API 一致性需要契约校验和真实 Axum 集成测试；使用同一种语言不会自动消除接口字段、方法或路径的差异。

代价包括 Rust/WASM 编译时间、WASM 启动和下载体积、浏览器调试复杂度，以及部分 DOM/第三方库需要明确适配。当前采用 CSR，首次页面内容依赖浏览器加载和执行 WASM；`xocs` 的公共内容页也没有增加 SSR 输出，搜索抓取和无 JavaScript 阅读的收益仍需后续 SSR 工作实现。Leptos 不保证相较 React 自动更快；性能结论需要同条件测量。WASM 也不能直接使用浏览器外的操作系统 API。

选择现有 Leptos 的原因是复用其响应式更新、组件生命周期和 DOM 管理；不自建 Rust/WASM UI 框架。底层媒体、上传和图表仍可按需要直接使用 web-sys。

## 验证和维护

验收包括 Rust 原生契约测试、严格 Clippy/rustfmt、构建脚本输入追溯测试，以及实际加载 WASM 的 Chromium/Firefox 浏览器用例。页面上的 `data-xcss-runtime="leptos"` 仅由 Rust 启动代码设置，不能仅凭 Vite 构建成功判断迁移完成。后台嵌入资源检查验证 WASM 魔数、精确字节与 application/wasm MIME，保留字体许可证及现有缓存/CSP规则。

首次迁移记录使用固定提交链接复查；已完成的迁移分支现已删除：

- [公共浏览器组件](leptos-web.md)
- [媒体管理](https://github.com/isarmg/xcos/blob/3875d1d8406187243463980897ffd103e9b857a1/docs/leptos-web.md)
- [文件管理](https://github.com/isarmg/xczs/blob/3c585b609314f01eabd2696562788b4d29e08750/docs/leptos-browser.md)
- [内容系统](https://github.com/isarmg/xocs/blob/899839b1740562bf527356830315d5a31262d68b/docs/leptos-migration.md)
- [RustDesk 管理](https://github.com/isarmg/xscs/blob/0f21b0cc1281e5bbca89006e4d7d389417251247/docs/leptos-web.md)
- [主机监控](https://github.com/isarmg/xsos/blob/d5a7c3f19ec6ef8c910845dcf2c87732758a20d4/docs/leptos-web.md)
- [用户与配额](https://github.com/isarmg/xszs/blob/ef1d2e094c3c4702f2d3225c62ee7d828a75a44a/docs/leptos-web.md)


## Axum 对 WASM 的适配

后端保留 Axum，并对浏览器资源作针对性优化：构建时生成 `.wasm.gz`，运行时按 `Accept-Encoding` 协商，返回 `application/wasm`、`Content-Encoding: gzip` 和 `Vary: Accept-Encoding`。压缩与原始表示使用各自的强 ETag；HEAD、304 及缺失压缩文件回退保留原资源服务语义。HTML 预加载 WASM，让下载提前开始。沿用原有缓存策略，未以文件名猜测是否可永久缓存。

压缩适配只用于静态 WASM，不涉及认证/API 响应。通用实现维护在 `xcss/scripts/leptos-assets.rs` 与 `xcss/web/leptos-assets.mjs`；`vendor-leptos.py --check` 同时验证六个独立仓库中的副本。

首次迁移代码单独提交到各仓库的 `feat/leptos-migration`，当时的 `main` 保留 React 方案。该阶段分支提交与推送没有触发线上部署，服务发行继续使用原发布流程。

## 依赖清单与审计

六个产品的前端 Rust 锁文件已纳入 CI 和发布流程的独立 `cargo audit --deny yanked` 检查。2026-10-16 使用当天本机 RustSec 数据库与 registry 索引检查，六份锁文件均通过；保留的 `paste 1.0.15` 产生上游停止维护提示 `RUSTSEC-2024-0436`，没有新增忽略规则。

`leptos-build.json` 记录前端 Rust 包、来源及校验和，作为现有发布清单的补充；这些包目前没有合并进远端打包器输出的 CycloneDX SBOM。根锁文件的原有审计、打包器版本及发布权限边界继续沿用。

## 本次验收结果

2026-10-16，六个产品的默认构建均已切换为 Leptos CSR，生产 npm 锁图中没有 React、ReactDOM 及 React Vite 插件。公共组件快照与静态资源适配器已逐一校验；源码摘要、生成的 WASM、发布清单和 gzip 解压字节一致。

Rust 原生契约、wasm32 严格 Clippy、后端格式与严格 Clippy，以及实际 WASM 的 Chromium/Firefox 回归均已执行。文件管理完成 Chromium 146/146、Firefox 完整与针对性迭代回归、默认入口双引擎各 7 项及语言验收；原上传与取消时间预算保留。内容管理完成两个引擎各 25 笔真实 Axum UI 写入与原公开页面、认证、资源及恢复检查。一次 Firefox 菜单点击瞬态失败在集中选择探针和原写入流程定向复测中未复现，未据此修改业务或放宽断言；分轮证据见产品文档。

以下为本次优化构建中 WASM 主体的实际字节数；不含字体、CSS、JavaScript 和内容图片，不是 React/Leptos 运行速度对比。

| 产品 | 原始 WASM / bytes | gzip / bytes |
| --- | ---: | ---: |
| `xcos` | 1,372,699 | 378,999 |
| `xczs` | 1,316,200 | 385,194 |
| `xocs` | 3,023,038 | 903,172 |
| `xscs` | 712,553 | 221,700 |
| `xsos` | 1,036,557 | 319,304 |
| `xszs` | 800,972 | 257,162 |

## 构建产物清理

依照本次授权，已清理工作区内五个 Cargo 构建目录、六个产品的 `web/dist` / `web/pkg`、`xczs/web/runtime-dist`，以及已确认的 Vite、Python、TypeScript 缓存和测试输出。删除占用估算约 19.6 GiB，收尾时文件系统可用空间约 19.5 GiB。清理前逐项验证路径、生成标记、Git 状态及进程占用；下次默认构建会重新生成这些输出。

精确清理记录与最终源码/产物核验保存在当次多仓工作区的 `.local/workspace-build-cleanup-2026-10-16/`；这些本机操作记录不随 GitHub 源码分支发布。六份构建输入与输出摘要已另存为证据，工作区内的实际 WASM、打包目录和编译缓存已删除。
