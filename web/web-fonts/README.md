# 默认字体：英文 Normal NL 正体 / 中文 / 日文

- 西文使用官方 v7.9 Maple Mono Normal NL 的 Regular/Bold WOFF2，字形为普通直立、非手写体，字体元数据 italicAngle 为 0，不以 CSS 抵消斜体。
- `calt`、`liga`、`clig`、`dlig` 关闭，不另行启用手写风格特性；关闭字体合成。英文粗体有独立 Bold 文件。
- CJK 使用官方 Maple Mono NL CN v7.9 的 Regular/Bold 正体，保留该字体提供的中文、日文及西文字体未覆盖的其他字符。并非承诺覆盖 Unicode 的所有汉字。
- 西文与 CJK 合并为两个完整的 Regular/Bold WOFF2，不使用 Unicode 分片或 Bootstrap 子集。每个字体保留 22,731 个码点；单个字体资源预算为 16 MiB，JS/CSS 和其他资源仍使用原有预算。
- 管理 Web 首次访问调用 `startAfterFonts()`：一次加载并解码两个完整字体，完成后再挂载页面，页面内切换菜单不再触发字体请求。
- HTML 在 `head` 中内嵌 `boot.css`，并设置 `data-xcss-fonts="pending"`；准备期间只显示与系统主题一致的纯色背景。没有超时或加载失败后的系统字体回退，失败时保持背景，重新载入页面可重试。
- CSS 统一使用 `font-display:block`。字体加载 Promise 在同一文档内复用，所有入口、登录页和后续菜单使用同一组已解码字体。

## 可复现工具链

在隔离 Python 环境安装 `fonttools[woff]==4.60.1`、`brotli==1.1.0`，将 `provenance.json` 中指定的官方 ZIP 下载到显式路径，然后运行：

```sh
python web/web-fonts/scripts/extract-normal-latin.py /absolute/MapleMonoNormalNL-Woff2.zip
python web/web-fonts/scripts/build-full.py /absolute/MapleMonoNL-CN-unhinted.zip
node web/web-fonts/scripts/build.mjs
```

生成器检查完整 cmap 为两个源字体的并集，保留 Normal NL 西文字形，合并完整 CJK 字符覆盖。不修改外部 Maple 项目。源归档与西文字体摘要、生成工具版本、完整字体摘要均记录在 provenance.json。

## 当前发行分发

字体通过唯一正式 `@xcss/web` 包的 `web-fonts` 公开子路径分发。消费者固定不可变发行包，并在构建时校验来源、摘要和许可证。
管理 Web 通过包依赖使用 Normal NL 正体与 CJK 资源。
消费者导入包的 CSS，构建时校验来源、字体摘要和许可证，运行时只加载产品同源资源，不需要同级 xcss 工作区或 CDN。

更新字体必须发布新的不可变包、更新消费者锁图并重建资源合同，不能覆盖旧归档或伪造原生平台验收。
随包保留对应许可证；客户端本机 Web 不属于此次服务端管理 Web 范围。

已使用审核过的字体源码快照的服务端同步 CSS、启动模块、内嵌背景样式及对应摘要，保留已审核的字体二进制。消费者的 CSS 引用固定发行包中的字体文件，由产品构建检查验证资源路径。`startup.json` 固定启动模块和背景样式摘要；消费者构建不读取同级 xcss 工作区。

使用冷缓存分别阻塞完整 Regular 和 Bold 字体，验证网站仅显示纯色背景，等待超过 1.2 秒也不显示系统字体；释放两个字体后再进入页面，检查完整字体已解码、后续字符和菜单不产生新字体请求：

```sh
node scripts/check-font-startup.mjs --source web/web-fonts
node scripts/check-font-startup.mjs --source web/web-fonts --color-scheme dark
```

产品接入由消费者自己的测试负责启动测试服务、准备页面与 API，以及建立测试会话。共享检查器只接收已准备好的完整页面 URL，不读取或识别产品源码目录：

```sh
node scripts/check-font-startup.mjs --url http://127.0.0.1:4173/login
node scripts/check-font-startup.mjs --url http://127.0.0.1:4173/ --url http://127.0.0.1:4173/#settings --storage-state /absolute/test-session.json
```

`--source` 与 `--url` 互斥；`--url` 可以重复。默认检查浅色背景，深色页面可显式传入 `--color-scheme dark`。`--storage-state` 是可选的 Playwright 测试会话文件，仅用于隔离测试环境。产品测试继续负责验证实际入口、导航和会话行为；共享检查器不替换页面、重写资源路径或模拟业务 API。
