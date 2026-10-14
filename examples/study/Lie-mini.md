---
title: 从矩阵交换子到李代数
status: demo
---

# 从矩阵交换子到李代数

这是插件测试用的原创微型讲义. 先修是二阶矩阵乘法与向量空间; 不预设已经熟悉李括号. 主线是先实际算出两种乘法次序的差, 再说明这个运算保留的结构, 最后辨认理想的条件. 练习不替代正文中的首次计算与证明.

## 1. 次序为什么值得保留

取复数域上的矩阵空间 $M_2(\mathbb C)$. 对矩阵 $X,Y$, 定义交换子

$$
[X,Y]=XY-YX.
$$

它的输入是两个矩阵, 输出仍是矩阵. 以下三个矩阵会贯穿计算与结构辨认:

$$
e=\begin{pmatrix}0&1\\0&0\end{pmatrix},\quad
f=\begin{pmatrix}0&0\\1&0\end{pmatrix},\quad
h=\begin{pmatrix}1&0\\0&-1\end{pmatrix}.
$$

先算一个完整例子. 按行乘列,

$$
ef=\begin{pmatrix}1&0\\0&0\end{pmatrix},\qquad
fe=\begin{pmatrix}0&0\\0&1\end{pmatrix}.
$$

所以 $[e,f]=h$. 同样, $he=e$, $eh=-e$, 从而 $[h,e]=2e$; $hf=-f$, $fh=f$, 从而 $[h,f]=-2f$.

这个运算双线性. 例如 $[h,ae+bf]=a[h,e]+b[h,f]=2ae-2bf$. 方括号表示交换子, 不能任意改变嵌套括号的次序.

^lie-commutator

## 2. 从运算到结构

> [!note] 李代数
> 复向量空间 $\mathfrak g$ 配备双线性映射 $[\ ,\ ]\colon\mathfrak g\times\mathfrak g\to\mathfrak g$, 满足 $[x,x]=0$ 及 Jacobi 恒等式
> $[x,[y,z]]+[y,[z,x]]+[z,[x,y]]=0$, 就称为复李代数.

双线性和 $[x,x]=0$ 蕴含 $[x,y]=-[y,x]$: 展开 $[x+y,x+y]=0$, 再消去两个自身括号即可. 下面完整验证矩阵交换子的 Jacobi 恒等式. 结合律允许省去普通矩阵乘法的括号, 并给出

$$
\begin{aligned}
[X,[Y,Z]]&=XYZ-XZY-YZX+ZYX,\\
[Y,[Z,X]]&=YZX-YXZ-ZXY+XZY,\\
[Z,[X,Y]]&=ZXY-ZYX-XYZ+YXZ.
\end{aligned}
$$

三行相加, 每种乘积恰好出现一次正号和一次负号, 总和为零. 另外 $[X,X]=XX-XX=0$, 所以 $M_2(\mathbb C)$ 确为李代数. 此处证明依赖的是普通矩阵乘法的结合律, 不是李括号的结合律. $\square$

令 $\mathfrak g=\operatorname{span}_{\mathbb C}\{e,f,h\}$. 第一节的三个计算及反对称性、双线性表明, 任意两个 $\mathfrak g$ 中的矩阵的括号仍在 $\mathfrak g$ 中. 李代数公理从 $M_2(\mathbb C)$ 限制下来, 所以这也是李代数. 每个矩阵 $ae+bf+ch$ 的迹为零; 反之每个迹零的二阶矩阵均有这种唯一表达. 因而这就是 $\mathfrak{sl}_2(\mathbb C)$.

^lie-structure

## 3. 理想条件怎样用

> [!note] 理想
> 李代数 $\mathfrak g$ 的线性子空间 $I$ 是理想, 若对每个 $x\in\mathfrak g$ 与 $u\in I$, 都有 $[x,u]\in I$.

这要求任意外部元素与子空间元素取括号后仍留在子空间. 仅验证 $[I,I]\subset I$ 只能说明它是子代数, 不能说明它是理想.

例如 $I=\mathbb Ch$ 在 $\mathfrak{sl}_2(\mathbb C)$ 中是子代数: 两个 $h$ 的倍数的括号为零. 但它不是理想, 因为 $e\in\mathfrak g$, $h\in I$, 而 $[e,h]=-2e\notin I$. 这一步再次使用了第一节的同一组矩阵, 现在用于辨认定义中的量词.

主动回忆时可以合上第一节, 独立计算 $[h,2e+f]$, 再说明为何这个计算不能使 $\mathbb Ch$ 成为理想. 清单提供邻近题及可选提示, 完整正文始终保留.

^lie-ideal

## 来源与范围

本文为原创测试样本, 无教师题目或私人教材摘录. 只处理矩阵交换子、李代数定义和一个理想非例, 不声称证明了 $\mathfrak{sl}_2$ 的单性. 练习解答与 AI 反馈均需读者核对.
