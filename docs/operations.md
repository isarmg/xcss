# xcss 发行工具操作

xcss 是编译进产品的库。本文随 release-tool 归档提供，说明如何核对发行资产及使用其中的 Python 工具；Python 3 即可运行验证器。

## 验证下载的资产

从同一版本发行页取得 `release-tree.json` 和 `artifacts/` 中的资产，保持以下目录：

```text
release-tree.json
artifacts/
  xcss-release-tool-1.0.0.tar.gz
  state-contract.json
  release-identity.json
  build-inventory.json
  SHA256SUMS
```

在下载目录先核对字节完整性：

```sh
(cd artifacts && sha256sum --check SHA256SUMS)
```

预期每项显示 `OK`。清单用于验证文件，发行来源还需结合可信的 GitHub 仓库、标签和完整源码修订确认。

将 release-tool 归档解压到独立目录，在工具根目录执行：

```sh
python3 scripts/xcss-release.py --version
python3 scripts/xcss-release.py verify /absolute/download/artifacts /absolute/download/release-tree.json
```

输出应为 `release tree: passed ...`。验证器核对精确文件集合、路径、权限、大小和 SHA-256；目录中额外文件也会失败。包中的 `LICENSE` 为 Apache-2.0 文本。

## 生成清单

为产品的完整发行目录生成清单时，先确定五字段发行身份：product、version、source_revision、target 和 state_contract_sha256。下面变量全部填写为已确认的真实输入；清单输出放在被描述目录之外。

```sh
python3 scripts/xcss-release.py create /absolute/release/artifacts   --product "$PRODUCT" --release-version "$VERSION"   --source-revision "$SOURCE_REVISION" --target x86_64-unknown-linux-gnu   --state-contract-sha256 "$STATE_CONTRACT_SHA256"   > /absolute/release/release-tree.json
```

生成后运行上一节的 `verify`。产品继续核对自己的可执行文件、伴随程序和部署要求。

## 在源码仓库构建发行

原生发行使用 Linux x86_64 GNU、Rust `1.99.0` 和 Python 3，按[开发指南](https://github.com/isarmg/xcss/blob/main/docs/development.md)完成相关检查。正式构建要求源码干净、原生版本一致、精确 `v1.0.0` 标签指向当前 HEAD，随后由原生发行工作流执行：

```sh
python3 scripts/build-release-assets.py   --output "$RUNNER_TEMP/xcss-release"   --source-revision "$GITHUB_SHA"   --tag "$GITHUB_REF_NAME"
```

这些环境变量由 GitHub Actions 提供。本地验证使用等价的明确路径、完整源码 SHA 和标签。原生脚本生成发行工具、状态/发行身份、构建清单、校验文件和外层 release-tree。

Web 2 使用独立 `web-v2.0.0` 标签及 `release-web.yml`。该流程使用精确 Node、pnpm、Rust 和 wasm-bindgen，验证公开模块、真实 Rust CSR 双引擎浏览器和安装归档，再执行：

```sh
python3 scripts/build-web-release-assets.py --output "$RUNNER_TEMP/xcss-web-release" --source-revision "$GITHUB_SHA" --tag "$GITHUB_REF_NAME"
```

Web 输出为 `xcss-web-2.0.0.tgz`、`xcss-web-release.json` 和 `SHA256SUMS`。描述符绑定真实 tgz 的完整源码修订、版本、精确 GitHub URL、大小、SHA-256 和 SHA-512 integrity。下载后先执行 `sha256sum --check SHA256SUMS`，再核对可信标签和描述符；产品锁文件须记录同一 URL 和 SHA-512。Web 发行不修改原生 1.0.0 或历史 Web 1.0.0 资产。

发布后回下载所有资产，执行完整校验，并在独立消费者中用固定 revision/tgz 重建验证。已公开的标签与资产保持不变；修复通过新版本交付。

## 常见问题

| 现象 | 检查与处理 |
|---|---|
| 摘要、大小或权限不一致 | 核对是否混入不同版本文件，重新从可信发行来源取得对应资产 |
| 文件缺失或多余 | 对照发行清单恢复完整目录，普通下载说明放在 artifacts 外 |
| 输入是链接或特殊文件 | 使用实际普通文件组成的独立验证目录 |
| 源码脏或标签不匹配 | 在正确源码与标签上重新构建，保存未提交工作后再准备发行 |
| 消费者仍使用旧行为 | 更新产品依赖和锁文件，重建、测试并重新发布产品 |

其余构建、认证、数据库和 Web 问题见[排查指南](https://github.com/isarmg/xcss/blob/main/docs/troubleshooting.md)。软件包格式见[发行参考](https://github.com/isarmg/xcss/blob/main/docs/reference/package-release.md)，许可证见 [LICENSE](../LICENSE)。
