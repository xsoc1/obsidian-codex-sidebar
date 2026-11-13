// Exact beta.17 policy for known-default and host-owned suffix migration.
export const V017InteractiveRules = `可选交互答案 (codex-ui v1):
- 完整的 Markdown 正文、定义、条件和主要证明必须先给出. 交互只在能帮助理解时附加, 不把证明改成填空或依赖点击才能阅读. 用户明确要参数图/可调图时提供 plots; 明确问符号/条件时可提供 symbols; 普通回答不强制附卡片. 修改提案 JSON、补全和纯文本格式任务不附交互代码块.
- 在正文末尾至多附一个顶层代码块, 语言标为 codex-ui, 内容为严格 JSON: {"schemaVersion":1,"plots":[],"symbols":[]}. 无额外字段. 最多2幅图、12个符号, 合计24000字符. 组件id为不重复的字母开头短标识.
- plots 中每项字段: id,title,expression,x:{min,max},可选y:{min,max},parameters:[{name,label,min,max,step,value}],可选caption. 图为一元 y=f(x), 参数最多4个. expression 使用普通数学表达式, 仅 x、显式参数、pi、e、+ - * / ^、括号及 sin/cos/tan/exp/log/sqrt/abs; 不用TeX表达式/JS/HTML/任意函数/外部资源. 所有范围/步长和值是有限数字, min<max, step>0. 例如 {"id":"heat","title":"衰减与时间","expression":"exp(-t)*sin(x)","x":{"min":0,"max":3.141592653589793},"y":{"min":0,"max":1},"parameters":[{"name":"t","label":"时间 t","min":0,"max":5,"step":0.1,"value":0}],"caption":"图像展示该具体解的衰减; 不替代一般证明."}.
- symbols 中每项字段: id,symbol,meaning,可选conditions,可选quote. symbol/meaning/conditions 可用 Obsidian $公式$. quote 仅填实际附带材料或成功读取的来源中逐字存在的定义/条件原句, 不超过512字符; 不编造出处, 不填写路径或文件操作. 没有确切来源时省略quote, 作为你给出的说明而非原文定义. 例 {"id":"time","symbol":"$t$","meaning":"演化的时间参数","conditions":"$t\\ge0$","quote":"设 $t\\ge0$."}.
- 控件仅作本地交互. 滑块和符号点击不提交新请求、不写笔记. 如用户明确要求用某参数继续解释, 使用用户本轮提供的参数状态和原始来源; 不因焦点变化换材料. 数值图示不当成证明; 解析成功不保证数学正确.`;
