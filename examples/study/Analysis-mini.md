# 用一个误差上界理解一致收敛

这是原创测试样本. 先修为函数与实数极限, 主线为从每点误差转向同一个对全部点有效的误差上界.

## 1. 同一个阈值

> [!note] 一致收敛
> 设 $f_n,f\colon[0,1]\to\mathbb R$. 若对每个 $\varepsilon>0$, 存在正整数 $N$, 使所有 $n\geq N$ 及所有 $x\in[0,1]$ 都满足 $|f_n(x)-f(x)|<\varepsilon$, 就说 $f_n$ 一致收敛到 $f$.

这里 $N$ 可以依赖 $\varepsilon$, 但不能依赖 $x$. 逐点收敛允许针对每个固定 $x$ 选择阈值, 所以两个量词次序并不相同.

取 $f_n(x)=x/n$, $f(x)=0$. 第一次实际运算给出

$$
|f_n(x)-f(x)|=\frac{x}{n}\leq\frac1n\qquad(0\leq x\leq1).
$$

给定 $\varepsilon>0$, 选正整数 $N>1/\varepsilon$, 则对全部 $n\geq N$ 和全部 $x\in[0,1]$, 误差不超过 $1/n\leq1/N<\varepsilon$. 这就是一致收敛. $\square$

^analysis-uniform

## 2. 为什么这种控制有用

若每个 $f_n$ 在 $[0,1]$ 连续且 $f_n$ 一致收敛到 $f$, 则 $f$ 连续. 固定 $x_0\in[0,1]$ 和 $\varepsilon>0$, 一致收敛先给出一个 $n$, 使所有 $x$ 的 $|f_n(x)-f(x)|<\varepsilon/3$. 再用这个固定 $f_n$ 在 $x_0$ 的连续性, 选择 $\delta>0$, 使 $x\in[0,1]$ 且 $|x-x_0|<\delta$ 时, $|f_n(x)-f_n(x_0)|<\varepsilon/3$. 三角不等式给出

$$
|f(x)-f(x_0)|\leq |f(x)-f_n(x)|+|f_n(x)-f_n(x_0)|+|f_n(x_0)-f(x_0)|<\varepsilon.
$$

于是 $f$ 在每个 $x_0$ 连续. 一致误差上界用于同时控制两个位置, 连续性只用于中间一项. 不能据此再断言导数也收敛. $\square$

^analysis-continuity
