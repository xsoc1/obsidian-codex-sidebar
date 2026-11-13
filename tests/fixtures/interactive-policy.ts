export interface InteractivePolicyCase
{
	Id: string;
	Question: string;
	Source?: string;
	Expected: "plots" | "symbols" | "none" | "no-plots";
	Parent?: string;
}

const Frequency = "设 $0\\le x\\le2\\pi$, $k\\in\\{1,2,3,4\\}$. 定义 $f_k(x)=\\sin(kx)$. 这里 $k$ 只取给出的四个整数, $x$ 是空间位置.";
const Dual = "设 $V,W$ 为实向量空间, $T:V\\to W$ 是线性映射.\n\n$V^*=\\operatorname{Hom}_{\\mathbb R}(V,\\mathbb R)$ 是 $V$ 的代数对偶空间, $W^*=\\operatorname{Hom}_{\\mathbb R}(W,\\mathbb R)$ 同理.\n\n定义 $T^*:W^*\\to V^*$, 对 $\\varphi\\in W^*$ 和 $v\\in V$, 令 $(T^*\\varphi)(v)=\\varphi(Tv)$.";

export const InteractivePolicyCases: readonly InteractivePolicyCase[] = [
	{ Id: "frequency", Source: Frequency, Question: "这里 k 从 1 依次变到 4, 哪些部分变化了, 为什么? 我很难把式子和这种变化对应起来, 请把这个例子讲清楚.", Expected: "plots" },
	{ Id: "dual-map", Source: Dual, Question: "我总把这些对象分别属于哪个空间、箭头往哪边走搞混. 请解释它们之间的关系, 并说明复合的顺序.", Expected: "symbols" },
	{ Id: "one-line", Question: "只用一行给出 x^2 对 x 的导数.", Expected: "none" },
	{ Id: "no-ui", Source: Frequency, Question: "不要图或符号卡, 用普通段落说清楚 k 增大如何影响这个函数, 保留整数条件.", Expected: "none" },
	{ Id: "local-followup", Parent: "frequency", Question: "当前参数是 k=3. 只解释这一处求导: 为什么 f_3'(x)=3 cos(3x)? 不要重新展开其他部分.", Expected: "none" },
	{ Id: "abstract-objects", Source: "设 $V,W$ 为实向量空间, $T:V\\to W$ 为线性映射. 定义 $\\ker T=\\{v\\in V:T(v)=0\\}$ 和 $\\operatorname{im}T=\\{T(v):v\\in V\\}$. 没有给出坐标、维数或具体矩阵.", Question: "这里核和像分别在哪个空间里? 说明它们的区别即可, 不用额外具体矩阵替换这个抽象 T.", Expected: "no-plots" }
];
