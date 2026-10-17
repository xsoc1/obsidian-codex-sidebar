import type { InputRole, StudyAction } from "../../src/study/schema";

export interface ExpositionCase
{
	Id: string;
	Action: StudyAction | "chat" | "completion";
	Request: string;
	Source: string;
	Role?: InputRole;
	WriteText?: string;
	Truncated?: boolean;
	Pdf?: boolean;
	Quote?: string;
	History?: { Role: "user" | "assistant"; Text: string }[];
}

const Quotient = String.raw`设 $M,P$ 是域 $k$ 上的向量空间, $N$ 是 $M$ 的子空间, $f:M\to P$ 线性, 且 $N\subseteq\ker f$. 商空间 $M/N$ 的元素是陪集 $m+N$, 商映射为 $q(m)=m+N$. 目标是构造唯一线性映射 $\bar f:M/N\to P$, 使 $f=\bar f\circ q$.`;
const ShortProof = String.raw`设 $V,W$ 是域 $k$ 上的向量空间, $f:V\to W$ 线性. $0\in\ker f$. 若 $u,v\in\ker f$, $a,b\in k$, 则 $f(au+bv)=af(u)+bf(v)=0$. 因此 $\ker f$ 是 $V$ 的子空间.`;
const LanguageProof = String.raw`设 $f:V\to W$ 是域 $k$ 上的线性映射. 我们没有改变题目条件. 首先完成零向量检查: $f(0)=0$, 所以 $0\in\ker f$. 下面进行封闭性方面的处理. 对 $u,v\in\ker f$ 和 $a,b\in k$, 有

$$
f(au+bv)=af(u)+bf(v)=0. \tag{1}
$$

这一步没有擅自改变证明路线. 所以 $\ker f$ 是子空间. 我们并未声称已经经过形式化认证.`;

export const DevelopmentCases: ExpositionCase[] = [
	{ Id: "D01", Action: "chat", Request: "整理这组补充题的来源说明, 给出两道题及解答. 各题须能单独导出.", Source: "本组是配套补充练习. 1. 计算 diag(1,-1) 与 E12 的交换子. 2. 求线性映射 (x,y)→x+y 的核. 每题后又写: 这不是教师作业, 并未增设教师题." },
	{ Id: "D02", Action: "chat", Request: "检查这段证明, 直接给判断和依据. 没有错误就不要为了改而改.", Source: ShortProof },
	{ Id: "D03", Action: "symbols", Request: "解释根、根的取值和矩阵向量, 我有线性代数基础但符号不熟, 请给一次可复算的乘法.", Source: String.raw`在 $\mathfrak{sl}_3(\mathbb C)$ 中取 $H=\operatorname{diag}(h_1,h_2,h_3)$, $h_1+h_2+h_3=0$. 令 $\alpha_{12}(H)=h_1-h_2$, 则 $[H,E_{12}]=\alpha_{12}(H)E_{12}$.` },
	{ Id: "D04", Action: "sample", Request: "写一节可独立阅读的入门样章. 从所给商空间定义到因子映射, 给首次具体算例、完整良定义性、线性与唯一性证明. 我知道向量空间但商构造不熟.", Source: Quotient },
	{ Id: "D05", Action: "expand", Request: "展开插值抽取权分量的一步, 写明前提和不变性的用途.", Source: String.raw`底域无限, $\mathfrak g$ 有关于 $\mathfrak h$ 伴随作用的权空间直和分解, $I$ 是理想. $x\in I$ 只含有限多个不同权分量. 选择 $h_0$ 分离这些权的取值, 用插值多项式抽取分量.` },
	{ Id: "D06", Action: "check", Request: "核对这个等价是否需要区分实/复底域, 不要改写题面.", Source: String.raw`在有限维内积空间中, 自伴算子的全部特征值都是实数. 反过来, 一个算子只要全部特征值为实数就是自伴算子.` },
	{ Id: "D07", Action: "explain", Request: "解释这个例子说明了什么, 保留否定结论.", Source: String.raw`$f_n(x)=\sin(nx)/n$ 在 $\mathbb R$ 上一致收敛于零, 但 $f_n'(0)=1$.` },
	{ Id: "D08", Action: "feedback", Role: "complete-answer", Request: "我的尝试: fn 在 (0,1) 上逐点趋于 f, 且 |fn|≤n. 我认为由控制收敛可交换积分与极限. 请反馈我这一步, 只给下一步方向, 暂不展开完整标准解答.", Source: String.raw`练习: 检查仅凭逐点收敛及 $|f_n(x)|\le n$ 能否用控制收敛交换积分与极限. 没有给出共同可积控制函数.` },
	{ Id: "D09", Action: "chat", Request: "请总结我没有提供的《虚构分析讲义》第九节的证明安排.", Source: "仅有书名和节号, 没有该节内容. 可以说明需要什么材料, 也可以给明确标成自拟的组织建议." },
	{ Id: "D10", Action: "chat", Request: "先仅整理所给来源, 再另列一段自拟扩展讲义建议. 区分两者, 不修改来源.", Source: String.raw`来源只陈述: 线性映射的核是子空间. 它没有讨论商空间. 请保留此范围.` },
	{ Id: "D11", Action: "check", Request: "评估这项实验能支持什么结论.", Source: "计算脚本对 n=1,...,1000 验证一个整数序列均为正. 因此作者声称所有正整数 n 均满足正性. 没有归纳或其他证明." },
	{ Id: "D12", Action: "chat", Request: "是否已经编译并做 iPad 真机验收?", Source: "真实记录: LaTeX 源码已生成. 本次未执行编译, 没有 iPad 设备, 也没有相关真机结果." },
	{ Id: "D13", Action: "chat", Request: "Review the argument in English. State what follows and identify the exact gap.", Source: String.raw`Each $f_n$ is continuous on $[0,1]$ and $f_n(x)\to f(x)$ pointwise. The author concludes that $f$ is continuous, without further assumptions.` },
	{ Id: "D14", Action: "edit", Role: "complete-answer", Request: "只调整这段的语言, 去掉重复自我担保和流程复述, 写成自然的数学证明. 保留所有条件、公式、编号和原证明路线, 不另换证明.", Source: LanguageProof },
	{ Id: "D15", Action: "explain", Request: "只解释这个等式, 不修改文件.", Source: String.raw`若 $N\subseteq\ker f$, 则 $f(m+n)=f(m)$, 其中 $n\in N$.` },
	{ Id: "D16", Action: "completion", Request: "补全光标后的一小段, 不能替换前文.", Source: String.raw`设 $u,v\in\ker f$, 则 $f(u+v)=` }
];

export const HoldoutCases: ExpositionCase[] = [
	{ Id: "H01", Action: "chat", Request: "请检查当前证明并直接说明理由.", Source: String.raw`若 $f:[0,1]\to\mathbb R$ 满足 $|f(x)-f(y)|\le 3|x-y|$, 取 $\delta=\varepsilon/3$ 即得一致连续.`, History: [{ Role: "user", Text: "怎样检查一段证明?" }, { Role: "assistant", Text: "我没有擅自修改, 也不会冒称已经认证. 只能说可能没明显问题. 以上不构成正式证明认证." }] },
	{ Id: "H02", Action: "chat", Request: "只展开引用中的三角不等式这一步.", Source: "", Quote: String.raw`设 $a,b,c\in\mathbb R$. 三角不等式给出 $|a-c|\le |a-b|+|b-c|$. 若右侧两项各小于 $\varepsilon/2$, 则左侧小于 $\varepsilon$.` },
	{ Id: "H03", Action: "edit", Role: "complete-answer", Request: "只调整用户答案这段的表达, 保留数学内容及路线. 教师题和来源摘录均只读.", Source: "教师题: 证明任意线性映射的核是子空间.\n\n来源摘录: 子空间对线性组合封闭.\n\n用户答案:\n" + LanguageProof, WriteText: LanguageProof },
	{ Id: "H04", Action: "explain", Request: "解释这份截断的 PDF 片段当前能确定的内容; 缺失条件不要猜.", Source: String.raw`扫描页的人工识读片段: $f_n\to f$ ..., 所以 $\int f_n\to\int f$. 中间的假设未捕获, 页尾截断. 无法从当前页确认收敛方式与可积控制.`, Truncated: true, Pdf: true },
	{ Id: "H05", Action: "feedback", Role: "complete-answer", Request: "我的解法用 max 范数而非欧氏范数: 对 x,y∈R², 有 ||x+y||∞=max(|x1+y1|,|x2+y2|)≤max(|x1|+|y1|,|x2|+|y2|)≤||x||∞+||y||∞. 请核对, 不强迫改成参考解法.", Source: "练习: 证明 R² 上 max 范数满足三角不等式. 参考讲义用逐坐标上界法, 没要求唯一解法." },
	{ Id: "H06", Action: "edit", Role: "complete-answer", Request: "只调整语言, 保留原结论和证明路线. 如原路线根本不成立, 先交我决定.", Source: String.raw`我证明每个连续函数都可导: 设 $f$ 连续, 因 $f(x+h)-f(x)\to0$, 故 $[f(x+h)-f(x)]/h\to0$. 于是处处导数为零.` },
	{ Id: "H07", Action: "expand", Request: "重发原来的展开任务, 不重新捕获已经切换到的其他笔记.", Source: String.raw`原笔记 A: $T$ 线性, $T(u)=T(v)=0$. 展开 $T(2u-v)=2T(u)-T(v)=0$ 的依据. 捕获后用户打开了笔记 B, B 的内容不属于此任务.` },
	{ Id: "H08", Action: "sample", Request: "Write a self-contained English lecture section for independent export. Define Lipschitz continuity, compute one first example, and prove uniform continuity with full quantifiers. Preserve the source attribution.", Source: String.raw`Original supplementary source E8: $f(x)=2x+1$ on $\mathbb R$. A Lipschitz bound $|f(x)-f(y)|\le L|x-y|$ with a finite constant $L\ge0$ implies uniform continuity.` }
];
