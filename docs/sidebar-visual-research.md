# Obsidian 侧栏视觉改进调研

日期: 2026-10-25. 基线为已发布的 0.16.0. 本次交付是文档与独立视觉对照研究, 未修改插件功能、日常安装或远程桥, 未发布新版本.

## 结论与推荐方向

可以明显改善, 且不必替换前端框架或另写聊天系统. Obsidian 支持自定义 ItemView DOM, 也为插件提供主题 CSS 变量、内置图标和 Markdown 渲染 API; 当前侧栏可以继续沿用这些能力. [官方 Views 文档](https://github.com/obsidianmd/obsidian-developer-docs/blob/main/en/Plugins/User%20interface/Views.md), [样式约定](https://docs.obsidian.md/Reference/CSS%20variables/About%20styling), [官方 API 声明](https://raw.githubusercontent.com/obsidianmd/obsidian-api/master/obsidian.d.ts).

**设计判断:** 推荐以“原生精简”为默认, 对输入区、引用与修改提案采用少量独立表面, 配合清晰的文字层次. 重点是让正文更容易连续阅读、操作更容易区分. 大面积磨砂和浮动卡片更适合作为可选实验风格, 不作为首选.

本机源码核对: 0.16.0 已使用宿主语义颜色、`container-type: inline-size`、减少动态效果媒体查询, 并有四个可独立折叠的控制区. 正文已采用宿主字号的比例, 桌面最低 14px、移动最低 15px. 四个摘要主要使用同一层灰色 12px 文本, 正文区域与背景的层次仍较弱; 所以问题不只是“换一个颜色”或“加上容器查询”. 依据当前 `styles.css`、`src/main.ts`、`src/message-list.ts` 和 `src/sidebar-footer.ts` 核对; 后半部分属于视觉设计判断.

## 已核对的技术边界

### 宿主主题、颜色与排版

官方建议插件使用内置 CSS 变量, 以获得原生观感及社区主题兼容. 可以在 `.codex-sidebar` 内增加自己的语义 token, 再映射到 `--background-primary`、`--background-secondary`、`--text-normal`、`--text-muted` 和 `--interactive-accent`, 而不覆盖应用全局变量. [样式约定](https://docs.obsidian.md/Reference/CSS%20variables/About%20styling), [颜色变量](https://docs.obsidian.md/Reference/CSS%20variables/Foundations/Colors).

官方排版文档区分正文相关字体变量与 `--font-ui-*` 控件字体变量. **建议:** 数学正文继续跟随用户正文设置; 小型工具摘要使用 UI 字号, 但不要通过不断缩小字号扩大阅读区. 先统一标题、正文、辅助信息和段距的比例, 再做窄栏检查. [Typography](https://github.com/obsidianmd/obsidian-developer-docs/blob/main/en/Reference/CSS%20variables/Foundations/Typography.md).

当前颜色文档说明, Obsidian 1.13 起若干旧 `*-rgb`/HSL 变量仅为兼容保留, 推荐使用语义颜色配合 `color-mix()`. **建议:** 新设计不依赖旧 RGB token; 提供纯色基础声明, 支持时再使用混色增强. 该结论不表示仓库声明的最低应用版本必然支持所有新 CSS. [官方颜色变量](https://docs.obsidian.md/Reference/CSS%20variables/Foundations/Colors), [MDN color-mix](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/color_value/color-mix).

正文和辅助文字应检查对比度. WCAG 普通文字的 AA 基准为 4.5:1, 大字号文字为 3:1; 半透明背景不能只检查前景色本身. **建议:** 保留主题的正常正文颜色, 不让“淡灰极简”降低可读性. [W3C 对比度说明](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

### 控件与响应式

`setIcon()` 可将 Obsidian 内置图标放入自定义元素; 官方图标指导使用 Lucide 风格, 并提醒宿主支持的图标集合有版本边界. **建议:** 折叠、来源、连接等位置可以加入小型语义图标, 但保留可见中文名称. “提问”“生成修改预览”“停止”继续显示全文, 不以无标签图标取代, 不恢复已删除的悬停说明. [官方 Icons 文档](https://github.com/obsidianmd/obsidian-developer-docs/blob/main/en/Plugins/User%20interface/Icons.md).

容器查询依据组件容器而不是整个窗口的尺寸生效. 这适合桌面侧栏拖宽和 iPad 分屏, 但当前插件已经具备基础容器查询. **建议:** 下一步用它调整工具排列与标签留白, 让正文宽度优先, 不以设备名决定全部布局. [MDN 容器查询](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Containment/Container_queries).

Apple 建议触控目标至少 44×44 pt. 这是原生平台的设计基准, 不能直接声称 CSS 的 44px 就已经达到相同物理触达效果. **建议:** iPad 优先扩大可点击区域和相邻间距, 让视觉按钮仍可保持紧凑; 必须在真机触控下确认. [Apple UI Design Tips](https://developer.apple.com/design/tips/).

### 磨砂、阴影与动画

`backdrop-filter` 可以模糊元素后面的内容, 通常需要透明或半透明背景才能看到效果. 浏览器支持该属性, 并不等于某一 iPad WebView 的长数学对话已经达到流畅目标. **建议:** 如试验磨砂, 限于小面积顶部或输入区, 设不透明回退, 正文不铺满实时模糊. 普通边框和静态轻阴影也可表达层次; 是否更快仍应测量. [MDN backdrop-filter](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/backdrop-filter).

浏览器性能指导指出, 动画改变尺寸会触发布局, 绘制也会占用主线程; `transform`、`opacity` 通常更容易优化. 这不意味着本插件应给流式回答增加位移动画. **建议:** 保留已有稳定节点与阅读锚点, 不动画正文高度、宽度、段距或滚动位置; 仅在按钮反馈上尝试短暂颜色/不透明度变化. `will-change` 不应常驻在所有消息上. [浏览器动画性能指导](https://web.dev/articles/animations-and-performance).

`prefers-reduced-motion` 可读取系统减少动态效果偏好. 当前插件已经使用这一能力, 新风格应继续遵守; 去掉动画后也必须能辨认忙闲、焦点、选中与错误状态. [MDN 减少动态效果](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion).

### 安全区和 iPad 软键盘

WebKit 的安全区机制用于避开屏幕边缘、传感器区域等遮挡; 它不是通用的键盘高度接口. 软键盘可以缩小 visual viewport 而不缩小 layout viewport; `VisualViewport` 提供相应信息, 但不同嵌入环境仍需实测. **建议:** 延续宿主布局和现有局部 footer inset, 不改应用全局 viewport; 若要让输入区跟随键盘, 必须单独核对 iPad 分屏、横竖屏、硬件键盘、键盘收起和缩放. [WebKit 安全区说明](https://webkit.org/blog/7929/designing-websites-for-iphone-x/), [MDN VisualViewport](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport).

## 三条视觉路线

以下为设计建议, 不属于已实现或已验收的插件功能.

| 路线 | 主要处理 | 优点 | 取舍 | 建议 |
| --- | --- | --- | --- | --- |
| 原生精简 | 宿主配色, 一致圆角/间距, 细分隔线, 工具弱化, 正文优先 | 与现有主题自然融合, 空间利用直接, 改造范围较小 | 视觉装饰较少, 需要认真打磨排版 | 默认方向 |
| 阅读卡片 | 输入区/引用独立表面, 用户消息淡背景, 回答保留连续阅读, 修改提案更明确 | 来源、问题、回答、待采用内容更易区分 | 每条回答加完整外框会吞掉横向空间, 要限制嵌套与内边距 | 只在必要单元局部采用 |
| 局部磨砂 | 顶部或输入区微透明, 小面积 blur, 极轻静态阴影 | 有明确的悬浮层次和现代感 | 主题对比度、底色变化、WebView 性能与重绘都需额外核验 | 默认关闭的后续实验 |

## 推荐实施顺序

1. **先做静态层次.** 建立侧栏局部 token, 统一 4/8/12 等间距层级、圆角与文字比例. 输入区作为单独表面; 来源引用只在有关时出现, 不新增常驻说明行. 现有四区的保存键、展开节点、两个提交动作与停止位置不变.
2. **再整理工具与数学正文.** 图标辅助可见标签, 区分主要和次要动作; 保持答案连续阅读, 调整段落和列表节奏, 长公式/表格局部横向滚动. 继续由原 MarkdownRenderer/MathJax 链路承担正文渲染, 只改变其容器样式.
3. **最后评估装饰.** 在静态版本通过后, 才比较小面积磨砂与轻微反馈. 对流式正文不加进场、尺寸或平滑滚动动画; 选中回答时不移动其正文.

本轮独立对照稿用于比较原生精简、阅读卡片和局部磨砂; 它不是安装到 Obsidian 的实现. 对照稿的显示效果也不能替代实际主题、原生数学渲染或 iPad 验收.

## 实施前后的可验证条件

- 复用当前侧栏布局与流式 fixture, 检查 240/320/450/612px、明暗主题、所有控制区展开以及停止按钮可见性. 同内容比较正文可用宽高, 不以截图装饰程度替代可读性.
- 继续检查外部状态栏实际交叠, 保留 `sidebar-footer.ts` 的局部避让. 只检查自身 overflow 不足以排除外部遮挡.
- 长数学回答在流式更新、公式迟到渲染、复制选中、历史阅读和重开后不跳动; 复用 `MessageList` 节点与阅读锚点, 不重新渲染整份历史.
- 原生 Tab、中文 IME、键盘焦点、减少动态效果、图标与可见名称一起核验. 窄栏按钮文字完整, 触控尺寸以真机确认.
- iPad 必须检查前台长对话、分屏和软键盘开合; 本轮没有这些真机或性能测量, 不给出帧率、耗电或速度改善结论.
- 外观改动若后续实施, 应保留 0.16.0 移除工作台、两项设置位置、会话/任务快照、改稿确认与独立远程只读协议; 不重新扩展为学习工作台.

官方 API 与 CSS 的能力核对仅说明方案可行. 哪一种风格更适合本人的长数学阅读, 仍需在相同内容、相同栏宽下对照并由用户选择.

## 本轮独立对照稿检查

使用原创矩阵交换子示例制作三种可切换风格. 对照稿支持折叠区和草稿保留, 可调整栏宽、正文字号和外框圆角; 模型连接、发送和修改按钮仅表现产品外观, 不提交请求或写入笔记. 本地浏览器检查覆盖三种风格、320/540px 两档宽度、明暗配色, 共 12 个组合, 检查控件未横向溢出、底部三按钮完整可见、折叠操作保留草稿; 已查看窄栏和宽栏代表截图并修正新会话按钮内图标与文字换行.

该结果属于独立设计对照稿, 不属于实际 CodexView、Obsidian MathJax、真实模型、iPad 真机或性能测试. 本次没有改动运行时代码、安装资产或远程桥, 因此未重跑与文档无关的插件全套测试. 没有产生新版本、部署或公开推送.
