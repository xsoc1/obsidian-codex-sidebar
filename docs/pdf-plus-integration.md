# PDF++ 选区接入调研

本文保留 beta.9 的调研和验证历史。beta.12 已移除此适配器；当前操作见 [PDF 使用指南](pdf-support.md#在阅读器里直接框选)。

2026-11-05，用户要求评估能否借助已安装的 PDF++，让 PDF 的选段、定理框和公式区域像 Markdown 选区一样进入侧栏。建议把 **PDF++ 当作可选的定位与回链层**，由 Codex Sidebar 保持捕获、预览、推理和笔记修改的所有权。

## 可以复用什么

| 来源 | 接入路径 | 能达到的效果 |
| --- | --- | --- |
| 有文字层的段落 | 在 PDF 选区菜单加入「送到 Codex」，保存选中文字和原生 `#page=…&selection=…` 定位 | 一键提问、追问、从回答回到原选段；默认可按文字处理，不要求视觉模型 |
| 公式、图表、扫描题 | 用户用 PDF++ 框选，在侧栏显式粘贴其局部链接 `![[书.pdf#page=12&rect=x1,y1,x2,y2]]` | 复用现有局部图捕获和来源快照，发送前看预览；启用 PDF++ 时按矩形回跳，不启用时在版本可确认的前提下退回页级 |
| 已经摘录到笔记的模块 | Markdown 保留 PDF++ 来源链接，正文写自己的证明或笔记 | 像普通 Markdown 一样选段、审核改写；PDF 仍是只读来源，不修改教师原题或教材 |

PDF++ [文字选区与回链](https://ryotaushio.github.io/obsidian-pdf-plus/backlink-highlighting-basics.html) 依托 Obsidian 原生 PDF 深链接；[矩形链接](https://ryotaushio.github.io/obsidian-pdf-plus/embedding-rectangular-selections.html) 是 PDF++ 的扩展。它们定位的是物理页、文字层偏移或矩形，不能自动识别「定理」「证明」等结构；有目录的书也只有目录目标位置，不应把它直接当作整节边界。

## 首版方案

1. 优先实现两条入口：文字选区菜单直接捕获，以及侧栏「导入 PDF 选区链接」。识别明确的 `page + selection` 或 `page + rect`，用 Obsidian 的路径解析在当前 vault 中定位，拒绝歧义、外部链接和越界坐标。不监听剪贴板，也不执行 PDF++ 的模板。
2. 用同一 PDF 页的 PDF.js viewport 将 `rect` 从 PDF 用户坐标转换到以左上角为原点的归一化矩形，再交给现有 `PdfReader` 捕获。保留原文件字节版本、页码与选区定位；沿用只读来源、图像缓存、远程能力检查及每轮两张图的限制。视觉模型未启用时，扫描区域明确提示需要图像，不把整页文字冒充局部内容。
3. 在保留原 PDF 只读与版本检查的前提下，让文字选区走独立的文本捕获路径。现有 `PdfSnapshot.Pages[].Image` 是必填，不能省略字段或把 PDF 伪装成可编辑的 Markdown；需为文字选区单独定义兼容快照，或明确扩展 schema 并校验旧桥行为。文件已变化时只打开准确文件，不把旧坐标当成新内容。

不建议把 PDF++ 内部 `lastCopiedDestInfo` 或裁切按钮当集成接口。已装版本的 [文字菜单事件](https://github.com/RyotaUshio/obsidian-pdf-plus/blob/6a3218b9c506076b405438489e614bc9e22b833b/src/context-menu.ts) 只提供页码、文字和可选批注；精确文字锚点另从 [viewer 的选区范围](https://github.com/RyotaUshio/obsidian-pdf-plus/blob/6a3218b9c506076b405438489e614bc9e22b833b/src/lib/copy-link.ts) 读取。矩形手势结束后走复制、可选自动粘贴等带副作用的路径；PDF++ 的 [深链接处理](https://github.com/RyotaUshio/obsidian-pdf-plus/blob/6a3218b9c506076b405438489e614bc9e22b833b/src/patchers/pdf-internals.ts) 则已支持矩形定位。若要省掉「粘贴链接」一步，后续优先做侧栏自有的 PDF 页内框选，或等上游提供明确的只读选区事件。

## 本轮验证与验收边界

- Windows Obsidian「数学」库实读 PDF++ `0.40.31` 已启用，注册了文字选区链接和矩形选区命令；Codex Sidebar 当前为 `2.0.0-beta.8`。核对 PDF++ 同版本源码和现有 [PDF 捕获](pdf-support.md)。现版侧栏能捕获 PDF 文本和局部图，但来源跳转只到页；还没有导入 PDF++ 链接的入口。
- 以仓库原创 `examples/pdf/dense-formula-mini.pdf` 在宿主 PDF.js 中复验：`getViewport`、`convertToPdfPoint`、`convertToViewportRectangle` 在 0/90/180/270 度下往返误差不超过 `1.2e-16`（归一化坐标）；另用与现有 reader 相同的渲染平移方式得到 599×354 的非空局部图。该探针只验证坐标及裁切原理，未执行真实的菜单联动或 PDF++ 手势。
- 开发验收应覆盖：选文字→发送→回到原选段；框扫描公式→局部预览→发送→回到原区域；同名文件、旋转页、PDF 变化、插件缺失时正确拒绝或降级。iPad 需在真机验证长按、拖框和粘贴；源码有触摸分支，但不能用桌面探针替代。调研没有改代码、插件配置、PDF 或课程笔记。

## 2.0.0-beta.9 实施与发布

- 实现提交 `2848c39`. 本地 `npm run build` 和 321 项测试通过, 含无 PDF++ 时的降级, 选区链接与越界校验, 只发文本/仅一张裁切图, 原快照重发以及版本一致/变化时的来源导航. [普通 CI](https://github.com/xsoc1/obsidian-codex-sidebar/actions/runs/41937156553) 在 Windows 与 Ubuntu 的 Node 24 均通过.
- Windows “数学”库已热重载 beta.9, PDF++ 0.40.31 下原生侧栏可见导入按钮. 原创样本用 Obsidian PDF.js 5.3.34 验证了文字选区不渲染图像、扫描局部图 1600×1120、旧整页入口 1236×1600. 原生脚本用实际 viewer 的选区偏移、程序生成的文字层、菜单处理器和导入对话框走过捕获; 无真实右键手势或模型发送. 探针打开临时页触发笔记自动会话, 随后仅移除该空会话与两个原创临时文件; 已回读原会话、编辑器内容、笔记关联和编辑记录保持一致.
- [GitHub beta.9](https://github.com/xsoc1/obsidian-codex-sidebar/releases/tag/2.0.0-beta.9) 已公开. [发布流程](https://github.com/xsoc1/obsidian-codex-sidebar/actions/runs/41937724583) 成功, 匿名下载 7 个资产并核对两个 ZIP 的 4/17 个成员, Windows 安装的四个文件与公开资产一致. Stable latest 仍为 1.1.0, 独立桥未变. 本轮没有 iPad 真机、真实模型请求或真实导航手势验收.
