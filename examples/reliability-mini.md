# 原创伴读与来源测试小样

本页是原创测试材料, 可复制到临时笔记使用. 不包含真实课程、学习记录或教师原题.

## 交换子的计算

在 $M_2(\mathbb R)$ 中定义 $[A,B]=AB-BA$. 取

$$
H=\begin{pmatrix}1&0\\0&-1\end{pmatrix},\qquad E=\begin{pmatrix}0&1\\0&0\end{pmatrix}.
$$

直接按行乘列可得 $HE=E$, $EH=-E$, 因而 $[H,E]=2E$. 固定 $H$ 后, $A\mapsto[H,A]$ 是线性映射: 例如

$$
[H,aA+bB]=H(aA+bB)-(aA+bB)H=a[H,A]+b[H,B].
$$

这里交换子一般不满足交换律, 不能交换乘法次序来化简. 可选中第二个乘积, 请求解释符号差异, 再连续追问三次并使用关联链接回跳. ^original-commutator

## 反三角不等式

设 $X$ 是赋范空间. 三角不等式分别给出

$$
\|x\|-\|y\|\leq\|x-y\|,\qquad
\|y\|-\|x\|\leq\|x-y\|.
$$

两式合起来得到 $|\|x\|-\|y\||\leq\|x-y\|$. 因此 $x_n\to x$ 推出 $\|x_n\|\to\|x\|$, 不需要空间完备. 可在长回答尾部选中这一步, 检查引用仍包含原 Markdown 公式. ^original-norm

PDF 区域测试使用同目录下 [密集公式 PDF](pdf/dense-formula-mini.pdf). 先捕获当前页整图, 再选同页一处积分或分式区域, 总数保持两图. 这不是 OCR 精度或数学学习效果测评.
