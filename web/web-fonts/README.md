# 默认字体：英文 Normal NL 正体 / 中文 / 日文

- 西文使用官方 v7.9 Maple Mono Normal NL 的 Regular/Bold WOFF2，字形为普通直立、非手写体，字体元数据 italicAngle 为 0，不以 CSS 抵消斜体。
- `calt`、`liga`、`clig`、`dlig` 关闭，不另行启用手写风格特性；关闭字体合成。英文粗体有独立 Bold 文件。
- CJK 使用官方 Maple Mono NL CN v7.9 的 Regular/Bold 正体，保留该字体提供的中文、日文及西文字体未覆盖的其他字符。并非承诺覆盖 Unicode 的所有汉字。
- 西文与 CJK 合并为两个完整的 Regular/Bold WOFF2，不使用 Unicode 分片或 Bootstrap 子集。每个字体保留 22,731 个码点；单个字体资源预算为 16 MiB，JS/CSS 和其他资源仍使用原有预算。
- Rust CSR 启动时并发加载并解码两个完整字体，确认两种字重都存在后挂载。HTML 在 head 内嵌 `boot.css` 并设置 `data-xcss-fonts="pending"`，等待期间保持纯色背景。
- `web/xcss-web/startup.js` 在加载失败或 30 秒未完成时显示可见错误及主动重载按钮；不无限等待、不自动重试或伪造已就绪。正常页面只使用这组完整字体，故障信息使用系统字体以保持可读。
- CSS 使用 `font-display:block`。实际字体载入、启动失败、超时和主动恢复由独立真实 WASM 双浏览器测试验证。

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

实际公开行为验收：

```sh
pnpm test:fonts
pnpm test:startup
```

前者从实际构建资源阻塞 Regular/Bold 并检查挂载时序；后者验证字体及 WASM 失败、超时与主动重载恢复。产品继续运行自己的真实入口、导航和 Axum 服务验收。
