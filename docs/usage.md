# 组合公共模块

按产品需要使用下列入口。完整 Rust API 可用 `cargo doc --locked --all-features --no-deps --open` 阅读，Web 入口由根 `package.json` 的 exports 定义。

## 服务端接入顺序

1. 用 `xcss::config` 组合产品配置，再验证实际运行前提。
2. 用 `fs_safety` 和 `state_file` 打开产品私有状态、取得运行锁。
3. 选择 `admin_sqlite` 或 `admin_static`，验证当前管理员状态。
4. 挂载公共认证适配器，再组合产品业务路由。
5. 向 `ServerRuntime` 注册健康检查、后台任务和最后关闭资源的参与者，运行 HTTP 服务。

具体初始化和配置命令由产品提供。文件权限、诊断连接与锁的详细前提见[文件 API](filesystem-handles.md)、[配置和状态](configuration-cli-logging.md)、[运行时](platform-specifications/server-runtime.md)。

## 管理 Web

`createXcssAdminApplication` 组合产品身份、navigation、routes 和可选的共享 client。Shell 负责登录、恢复会话、退出、主题和通知；产品的业务组件通过 `useAdminApplication()` 获取 client、session 和 notify。

React 产品加载以下共享样式：

```css
@import "@xcss/web/design-tokens/tokens.css";
@import "@xcss/web/design-tokens/tokens.dark.css";
@import "@xcss/web/design-tokens/reset.css";
@import "@xcss/web/design-tokens/accessibility.css";
@import "@xcss/web/web-fonts/fonts.css";
@import "@xcss/web/admin-ui/styles.css";
```

Server 在入口显式启动圆角渲染器，采用用户提供的 Mac mini 外壳模型所拟合的七次 Bézier 轮廓；client 的原生圆角由各平台单独实现。每个角沿用同一局部曲线并等比缩放，矩形的长宽差由连接直线承担。该模型的理想曲线与直线在端点满足 G3，运行时 SVG 使用受控离散近似。默认几何误差目标为 0.05 CSS px，运行时使用更小的 0.02 px 预算。这是本地硬件模型的拟合结果，不是经 Apple 认证的 UI mask 或 SwiftUI `.continuous` 算法。

```ts
import { startServerCorners } from "@xcss/web/admin-ui/server-corners";
const corners = startServerCorners(document);
// 幂等启动；测试、卸载或 HMR 清理时调用 corners.stop()。
```

`--xcss-server-corner-extent` 是显式选入属性，注册为不继承，避免面板中的普通文字、圆形和胶囊被误选。产品可以设置长度或短边百分比，并使用 `--xcss-server-corner-mode: clip` 选入媒体裁切；默认 `paint` 只绘制背景、边框和阴影。`data-xcss-server-corner="none"` 可显式排除。已有 `overflow:hidden/clip` 的表面使用固定在宿主坐标的 mask，缩放子图片仍按宿主轮廓裁切；mask 的白色外环保留边框盒外的原生焦点环和阴影。圆形、胶囊、零圆角导航和登录字段保留原形状。

`--xcss-server-corner-control/panel/notification/dialog` 的角占用分别为 27/42/48/54 px，运行时限制为短边的一半。通知角色用于 toast、错误、空状态、加载提示、固定 3:2 文字卡片和登录卡片；文字卡片保持原尺寸、比例和六行布局，并在启用时通过 `--xcss-server-corner-text-inset` 保留至少 26 px 横向内缩。照片和图标使用 `--xcss-server-corner-photo:31.0568993271%`，沿用原拟合轮廓的角部比例，不另加 1:1:1 约束。它表示角的外接尺寸，不能当作圆弧半径。矩形上的百分比按短边计算，保持横纵相同的物理轮廓。

嵌套框通过不继承的 `--xcss-server-corner-nested` 显式选入，默认 `none`。`all` 从最近、可匹配的父框角部生成法向内缩轮廓，再将同一个轮廓用于子框四角；四角放不下时统一缩小，此时不再是严格等距的父框内边缘。`nearest` 只关联与父框对应两边内缩相同的实际角，其余角保留自身角色。父框、子框处于不一致的变换坐标系或内缩超出规则范围时保留独立轮廓，并记录原因。只有确认贴角布局的内外框才选入：相册图片使用 `all`，上两角是实际对齐的关联角，下两角复用同一轮廓以统一视觉。普通行内按钮、输入框、工具栏控件、侧栏控件、未贴角卡片及字段组保持独立角色；圆形、胶囊、透明结构层、连续表格及特殊导航不参与嵌套关联。

渲染器响应新增节点、尺寸、主题及交互状态。复杂渐变、CSS 图片背景和背景模糊保存在轮廓内的装饰子层；原生控件保持浏览器语义。生成的 SVG 使用控制器自己的 Blob URL，CSP 的 `img-src` 需允许 `blob:`；SVG 中不嵌任意 HTML 或外部图片。停止时先恢复作者样式，再释放 URL。强制颜色模式、有既有 mask/border-image、传统 table 布局、多片段行内元素、inset 阴影及不支持的边框形式恢复原样，并通过 `data-xcss-server-corner-state/reason` 标记原因。停止后恢复作者的行内样式，包括运行期间的新行内修改。轮廓绘制不作为点击命中边界使用。

产品只在业务样式中调节角色及显式选入范围；共享规则和运行时通过不可变 xcss 发行交付，不能复制公共实现到产品或将本地路径依赖提交为正式来源。

渲染器接管的背景、边框和阴影在交互状态切换时即时更新，不沿用这些原生绘制属性的 CSS transition。`transition-property:all` 会展开并保留尺寸、透明度、变换等未接管属性及各自的时长、延时和曲线，避免测量时恢复背景再设透明导致每帧反复触发 transition。停止后恢复作者的 transition 配置。

业务响应使用与产品 DTO 对应的运行时 guard。管理员会话和 CSRF 留在内存，刷新页面通过服务端 HttpOnly Cookie 恢复。修改请求超时可能已在服务端完成，按业务操作 ID 查询结果后决定是否重试。

布局与组合见[Shell](platform-specifications/admin-web-shell.md)；账号页见[账户设置](web-account-settings.md)；日期筛选见[日期控件](web-date-range.md)；请求预算和认证竞态见[HTTP 参考](reference/http-client.md)。

## 日志与诊断

通过 `LogRecord` 记录稳定事件与实例、请求或任务 ID，产品字段保持在自己的命名空间。默认写 stderr；安装轮转 sink 后，普通 emit 与 tracing layer 共享文件输出。默认单文件 8 MiB，保留 4 个归档，总计 40 MiB。

使用 `rejected_count` 观察 tracing 输出失败。日志与错误保留脱敏字段，详细查询条件和上限见[日志参考](configuration-cli-logging.md#通用结构化日志)。

## 构建和交付

管理 Web 通过 `xcss::web_assets` 内嵌到产品二进制。使用共同构建入口可保证先构建 Web，再编译 Rust，并核对实际资源；[内嵌构建参考](reference/embedded-web.md)给出配置和开发热更新步骤。随后执行产品自己的打包、安装与业务验收。
