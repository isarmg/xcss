# Rust 原生 CSR 迁移验证记录

本记录对应 `feat/rust-native-web` 的迁移验收。六个应用继续使用 Axum，精简 Leptos 0.8.19 由 xcss 统一分发，只构建 CSR；视图采用普通 Rust 函数式 builder。验收时迁移分支尚未合并，各应用的 main 仍保留 React，测试未部署到线上。

2026-10-17，上述迁移及相关 xssi 校验支持已合并到八个仓库的 `main`，成为当前主分支方案；未创建正式发行或执行线上部署。当前接入见 [main 使用说明](../README.md)，首次迁移的分支安排与验收数据按原记录保留。

共享组件与六个应用的 540 处 `view!` 已改为普通 Rust DOM/组件 builder；`#[component]` 属性宏保留。七份项目源码的语法扫描均为零视图宏，rustfmt、WASM Clippy 及六个优化版 WASM 构建已通过。11 份实际主机过程宏编译记录的 feature 均为 `csr`；Cargo metadata 的条件功能并集另行记录，不能充当实际编译清单。

生产前端构建使用 Rust CLI、Cargo 和 wasm-bindgen 0.2.129。六应用均在移除 node_modules，并把 node/npm/pnpm/npx/vite/python/python3 替换为失败命令的环境中实际构建成功。Node/Playwright 仍用于浏览器验证；wasm-bindgen JS glue、角标绘制适配器和 xcos 的 HLS 引擎保留。整套发布器的其他工具要求不由这一项前端验证消除。

## 实际输出

下表统计可服务文件的实际字节，gzip 列使用构建器产出的 `.wasm.gz`，不是另用其他 gzip 实现计算的数值。输出总量包括原字体、许可证、追溯文件及 gzip 副本，不等同于首次页面下载量。

| 应用 | WASM 原始字节 | WASM gzip 字节 | 输出文件 | 全部输出字节 |
| --- | ---: | ---: | ---: | ---: |
| xcos | 1,351,842 | 371,788 | 21 | 13,201,750 |
| xczs | 1,295,430 | 379,578 | 31 | 12,681,879 |
| xocs | 3,150,552 | 941,140 | 34 | 22,960,335 |
| xscs | 784,251 | 239,679 | 18 | 11,983,937 |
| xsos | 1,073,021 | 325,178 | 18 | 12,363,404 |
| xszs | 827,733 | 262,983 | 18 | 12,052,636 |

相同 typed 业务、同一精简框架基线下，xscs 原 view! 与函数式视图的真实 Axum 字节对照为：WASM 782,998 → 784,251 B（+0.16%）；构建器 gzip 238,870 → 239,679 B（+0.34%）。两者使用同一真实登录/设备写入浏览器 harness，每个引擎各 11 组通过。该对照只评估视图改写，不能当作 React 对 Leptos 的性能比较。

普通 Rust builder 关闭旧的静态 inert-template 路径，增加显式组件适配代码，并依赖这份固定框架的 helper API。收益是统一 Rust 语法、格式与类型检查；本轮没有证明启动、编译、内存或吞吐更快。框架 fork 与 helper 的升级维护需要继续承担回归成本。

## 检查范围

- Rust 资产工具 29 项、视图转换器 6 项测试通过；七份 WASM 源码 Clippy 零 warning。
- xcss 原生 CI：230 项通过，3 个原有子进程辅助用例由父测试调用；xocs 更新原生 provider 后完整 67 项通过。首次受限沙箱/默认并发运行的失败日志保留；最终采用仓库 CI 的权限与两个测试线程，未改变生产代码或断言。
- 六应用的最终生产构建均通过来源摘要、唯一 CSR 图、资源预算、许可证及输入漂移检查；386 个 Node 静态/历史 fixture 用例及 xscs/xsos 工具链脚本通过。
- xcos 的四套原双引擎浏览器回归、xscs 一套、xsos 四套通过。xszs 修正管理资源挂载后，原双引擎完整验收再次通过。
- xocs 新增及原有共 12 套浏览器回归首轮通过；13 个原生 domain 用例通过。真实 Axum/SQLite 另覆盖两引擎各 6 组分类、标签、文章写入/编辑、Markdown 与刷新读取。
- 六应用的真实原生 HTTP 资源合同与登录/fixture 验收通过；检查全部输出、字体、WASM gzip/identity、HEAD、ETag、304、CSP 与干净停机。xczs 完整 Firefox 146/146 通过，零重试、跳过或失败；Chromium 145 个原用例及修正后的资源用例通过，累计覆盖 292 个引擎/用例组合。
- xcos 在独立网络命名空间中运行真实 MediaMTX、Axum 和 SQLite；创建、改名、授权更新与重启后的会话/列表持久化通过，未接触已部署服务。
- xcos 实际 Rust 构建生成的前端 receipt 经原 xssi 流程下载并核验真实上游归档、摘要和许可，再绑定冻结二进制的编译清单，生成 hls.js、@xcss/web 和两项字体共四组件。该项是前端组件的发布集成验证，不代表完整 Rust/MediaMTX 产品 SBOM 或正式 release 发布完成。
- 发布入口既有 63 项打包/工作流检查通过。另以真实 CLI 对六个干净工作树执行 24 项入口检查：从其他目录传入产品根路径、显式/省略当前 HEAD、错误 revision 和绝对 config；核对 release target、源码身份与私有 0700 receipt 目录后在 Cargo 编译前主动停止。这些入口检查未执行完整 release 编译。

原生运行候选为 development/unbound，WASM 为优化版 release。真实 UI 验证使用私有 SQLite/文件系统；未连接真实摄像头、RustDesk agent 或 host client，也未测量实时媒体吞吐。浏览器 fixture 回归与这些实际后端检查分别记录。

## 验收发现与修复

xszs 的 Axum 管理入口一直是 `/admin/`，根路径保持 404。初次 Rust 配置遗漏了该 base，且沿用了固定字体预载 URL；实机测试捕获资源 404。现恢复 `/admin/`，字体预载改为 vendor 源路径并由构建器生成真实哈希 URL，重新执行无 Node 构建、原浏览器测试与真实后端验收。实机同时发现原内联字体启动样式被严格 CSP 拒绝，现将已有 boot.css 编入同源外链哈希 CSS。首屏和 reload 的完整严格 CSP 响应头保持不变，两引擎各 5 组通过且违规事件为空；初始匿名会话探测的 401 照实保留。浏览器 Rust 源码与 WASM 字节未变；原生二进制随内嵌资源更新。

xczs 首轮 Chromium 为 145 通过、1 失败，同一资源用例的原重试仍失败。原资源测试限定旧 64 位文件名并把图标相对路径按旧 dist 目录解释，导致真实 3 个 SVG 虽全部返回 200，测试仍提取零项。更新后按 CSS 的真实 URL 定位资源，保留数量、MIME 与 immutable 检查，并增加 nosniff、响应 SHA 前 16 位与文件名的绑定；构建器检查从旧 Python 文件摘要改为全部 Rust 源文件/锁文件逐项摘要及整体摘要。修正后的 Chromium 资源用例首个实际执行通过，另外一次 LAB grep 参数错误未执行测试，日志另存。其余 145 个用例与原字体、登录恢复、安全和无障碍断言保留。最终完整 Firefox 通过后，原生二进制、fixture、receipt 及全部测试源码 SHA 前后一致；浏览器可执行资源相对先前 Chromium 运行也完全一致，变化仅为构建来源元数据。

xocs 公开图片/视频约 7.8 MB，旧 Vite 的 bundle 预算没有涵盖直接复制的 public；本轮保留全部原字节与 URL，新增完整 public SHA 清单。清单验证后的媒体仅可进入 4 MiB/文件、8 MiB/总量的固定媒体桶，其余资源继续遵守普通 512 KiB、WASM 4 MiB、字体与 bundle 16 MiB 上限。所有输出继续绑定 receipt；未把旧版输出描述为通过全量 16 MiB 预算。

六个打包入口和两项目 CI 原先向新 CLI 传入绝对 config，违反其相对路径合同。现统一为 `--config xcss-web-build.json`，由显式 `--product-root` 解析，不依赖当前工作目录。绝对 dist、干净源码、HEAD 身份和原有发布检查保持原合同；工具、浏览器和全部 dist 字节未因此改变。

构建期间的来源漂移拒绝、public URL 解析失败、宏条件功能误判、临时 receipt 目录权限失败，以及修复前的浏览器/HTTP 日志均保留。完成声明以最后对应源码、产物和证据为准，不以自动重试掩盖失败。

## 重现与来源

产品根目录执行 `cargo +1.99.0 run --locked --manifest-path tools/web-build/Cargo.toml -- build --product-root .`；各项目文档列出 preview、Axum server 与原浏览器验收入口。框架/共享源码快照的 base_revision 指向最后改动浏览器 payload 的提交，逐文件摘要继续精确绑定全部字节；仅文档或服务端提交不再让同一快照失效。

验收时的原始日志、精确 SHA 清单、第一次失败及私有 fixture 状态曾保存在 `.local/rust-native-web-2026-10-17/`。2026-10-17，确认 main 使用精简 CSR 后，已按要求删除四个迁移临时目录、相关工作树及迁移和实验分支。源码、工具、测试、来源元数据和本摘要保留在 main；生成物与私有状态不进入仓库。

已合并实现使用以下固定提交复查：[xcss](https://github.com/isarmg/xcss/tree/d52485d40617bd16414cc147dcd2dbe85a4e3410)、[xcos](https://github.com/isarmg/xcos/tree/91ba2c338cd09cc9d6d16a4a1d33b240be061d68)、[xczs](https://github.com/isarmg/xczs/tree/94f0f38cb673bfd2a8d31ae3e335b577345b2a2f)、[xocs](https://github.com/isarmg/xocs/tree/ef55f5b8744014385efe986f06b9d1af37c69691)、[xscs](https://github.com/isarmg/xscs/tree/29b03e30a9f1bce5d8ea934641893ca4fa87340b)、[xsos](https://github.com/isarmg/xsos/tree/89b829b248b5624cd48be378550656344a4f6a50)、[xszs](https://github.com/isarmg/xszs/tree/49838edd03b7ddc2839f9aa3842f6cf73ab1df4e)、[xssi](https://github.com/isarmg/xssi/tree/81856c7ae7312ff3252463ee16f170e0ba487c23)。当前产品入口见[迁移总览](leptos-workspace-migration.md)。
