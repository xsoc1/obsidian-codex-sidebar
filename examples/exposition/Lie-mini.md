---
title: "矩阵交换子与根的取值"
fixture: D03
model: gpt-6.1-sol
effort: low
fast: false
skill_version: "0.2.0; production bridge selection"
review: "author AI reading; no independent or learner acceptance"
---

这里的关键是分清三个对象：$\alpha_{12}$ 是一个线性函数，$\alpha_{12}(H)$ 是一个复数，$E_{12}$ 是一个矩阵，也可以看成向量空间中的向量。

**1. 矩阵为什么也是“向量”？**

$\mathfrak{sl}_3(\mathbb C)$ 表示所有迹为零的 $3\times3$ 复矩阵组成的向量空间：

$$
\mathfrak{sl}_3(\mathbb C)
=\{X\in M_3(\mathbb C):\operatorname{tr}X=0\}.
$$

向量不一定写成一列数；只要使用相应的加法与数乘，矩阵也可以是向量。这里

$$
E_{12}=
\begin{pmatrix}
0&1&0\\
0&0&0\\
0&0&0
\end{pmatrix}
$$

就是这个向量空间中的一个非零向量。下标 $12$ 表示唯一的 $1$ 位于第 $1$ 行、第 $2$ 列。

**2. 括号表示什么？实际乘一次**

这里的 Lie 括号定义为矩阵的交换子：

$$
[H,X]=HX-XH.
$$

对于原文的对角矩阵 $H$，两次乘法分别是

$$
\begin{aligned}
HE_{12}
&=
\begin{pmatrix}
h_1&0&0\\
0&h_2&0\\
0&0&h_3
\end{pmatrix}
\begin{pmatrix}
0&1&0\\
0&0&0\\
0&0&0
\end{pmatrix}
=
\begin{pmatrix}
0&h_1&0\\
0&0&0\\
0&0&0
\end{pmatrix},\\[4pt]
E_{12}H
&=
\begin{pmatrix}
0&1&0\\
0&0&0\\
0&0&0
\end{pmatrix}
\begin{pmatrix}
h_1&0&0\\
0&h_2&0\\
0&0&h_3
\end{pmatrix}
=
\begin{pmatrix}
0&h_2&0\\
0&0&0\\
0&0&0
\end{pmatrix}.
\end{aligned}
$$

例如，第一个乘积的 $(1,2)$ 元是

$$
h_1\cdot1+0\cdot0+0\cdot0=h_1,
$$

第二个乘积的 $(1,2)$ 元是

$$
0\cdot0+1\cdot h_2+0\cdot0=h_2.
$$

所以相减得到

$$
[H,E_{12}]=(h_1-h_2)E_{12}.
$$

**3. “根”和“根的取值”有什么区别？**

令 $\mathfrak h$ 为所有迹为零的对角矩阵组成的子空间。原文定义的是线性函数

$$
\begin{aligned}
\alpha_{12}:\mathfrak h&\longrightarrow\mathbb C,\\
\operatorname{diag}(h_1,h_2,h_3)&\longmapsto h_1-h_2.
\end{aligned}
$$

因此，$\alpha_{12}$ 是一条取值规则；选定具体的 $H$ 后，$\alpha_{12}(H)$ 才是一个具体的数。例如

$$
H=\operatorname{diag}(2,-1,-1)
\quad\Longrightarrow\quad
\alpha_{12}(H)=2-(-1)=3,
$$

此时 $[H,E_{12}]=3E_{12}$。

用你熟悉的特征向量语言看：固定 $H$，映射

$$
\operatorname{ad}_H:X\longmapsto[H,X]
$$

是 $\mathfrak{sl}_3(\mathbb C)$ 上的线性变换。上面的等式说明，$E_{12}$ 是它的特征向量，特征值为 $\alpha_{12}(H)$。

更进一步，同一个 $E_{12}$ 对**每个** $H\in\mathfrak h$ 都满足这个等式。一般把满足

$$
\{X\in\mathfrak{sl}_3(\mathbb C):
[H,X]=\alpha(H)X\ \text{对所有 }H\in\mathfrak h\}\ne\{0\}
$$

的非零线性函数 $\alpha:\mathfrak h\to\mathbb C$ 称为一个**根**。所以这里 $\alpha_{12}$ 是根，$E_{12}$ 是相应的根向量。

根本身非零，并不要求它在每个 $H$ 上都取非零值：当 $h_1=h_2$ 时，$\alpha_{12}(H)=0$，此时 $H$ 与 $E_{12}$ 恰好可交换。
