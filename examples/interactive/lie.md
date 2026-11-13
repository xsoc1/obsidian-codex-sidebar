# 原创例子：矩阵交换子

在实向量空间 $M_2(\mathbb R)$ 中定义 $[A,B]=AB-BA$. 取

$$
H=\begin{pmatrix}1&0\\0&-1\end{pmatrix},\qquad
E=\begin{pmatrix}0&1\\0&0\end{pmatrix}.
$$

直接相乘得 $HE=E$, $EH=-E$, 因此 $[H,E]=2E$.

固定 $H$, 定义 $\operatorname{ad}_H(A)=[H,A]$. 由矩阵乘法对加法和数乘的分配律, 对任意实数 $a,b$ 和矩阵 $A,B$,

$$
[H,aA+bB]=a[H,A]+b[H,B].
$$

所以 $\operatorname{ad}_H$ 是线性映射. 上面的具体计算说明 $E\ne0$ 是它的特征值 $2$ 对应的特征向量. 这里仅核验线性及这个特征向量; 李代数的 Jacobi 恒等式需要另外验证.

```codex-ui
{"schemaVersion":1,"plots":[],"symbols":[{"id":"commutator","symbol":"$[A,B]$","meaning":"矩阵交换子, 比较先后两种乘法次序的差.","conditions":"本例 $A,B\\in M_2(\\mathbb R)$, 乘法是矩阵乘法.","quote":"在实向量空间 $M_2(\\mathbb R)$ 中定义 $[A,B]=AB-BA$."},{"id":"adjoint","symbol":"$\\operatorname{ad}_H$","meaning":"固定矩阵 $H$ 后得到的线性映射 $A\\mapsto[H,A]$.","conditions":"$H$ 固定; 被映射的变量是 $A$.","quote":"固定 $H$, 定义 $\\operatorname{ad}_H(A)=[H,A]$."}]}
```
