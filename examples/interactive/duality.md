# 原创例子: 对偶映射为什么反向

设 $V,W$ 为实向量空间, $T:V\to W$ 为线性映射. 代数对偶 $V^*$ 是所有实线性函数 $V\to\mathbb R$ 构成的向量空间, $W^*$ 同理.

给定 $\lambda\in W^*$, 定义 $T^*\lambda=\lambda\circ T$. 复合先把 $v\in V$ 送到 $Tv\in W$, 再由 $\lambda$ 取实数值, 所以结果是定义在 $V$ 上的函数. 这就是方向变为 $T^*:W^*\to V^*$ 的原因.

还需核对 $T^*\lambda$ 确实线性. 对任意 $v_1,v_2\in V$, $a,b\in\mathbb R$,

$$
\begin{aligned}
(T^*\lambda)(av_1+bv_2)
&=\lambda\bigl(T(av_1+bv_2)\bigr)\\
&=\lambda(aTv_1+bTv_2)\\
&=a\lambda(Tv_1)+b\lambda(Tv_2).
\end{aligned}
$$

第二步使用 $T$ 的线性, 第三步使用 $\lambda$ 的线性. 因而 $T^*\lambda\in V^*$. 这里没有假设有限维、范数或连续性; 所用对偶是代数对偶.

```codex-ui
{"schemaVersion":1,"plots":[],"symbols":[],"relations":[{"id":"directions","title":"原映射与对偶的方向","nodes":[{"id":"v","symbol":"$V$","meaning":"原映射的定义域.","quote":"设 $V,W$ 为实向量空间, $T:V\\to W$ 为线性映射."},{"id":"w","symbol":"$W$","meaning":"原映射的值域."},{"id":"ws","symbol":"$W^*$","meaning":"输入的线性函数定义在 $W$ 上."},{"id":"vs","symbol":"$V^*$","meaning":"复合后的线性函数定义在 $V$ 上."}],"edges":[{"from":"v","to":"w","label":"$T$"},{"from":"ws","to":"vs","label":"$T^*$"}]}],"walkthroughs":[{"id":"linearity","title":"核对复合的线性","steps":[{"id":"definition","symbol":"代入定义","meaning":"$(T^*\\lambda)(av_1+bv_2)=\\lambda(T(av_1+bv_2))$.","conditions":"$v_1,v_2\\in V$, $a,b\\in\\mathbb R$."},{"id":"tlinear","symbol":"展开 $T$","meaning":"$T(av_1+bv_2)=aTv_1+bTv_2$.","conditions":"使用 $T$ 的线性."},{"id":"llinear","symbol":"展开 $\\lambda$","meaning":"$\\lambda(aTv_1+bTv_2)=a\\lambda(Tv_1)+b\\lambda(Tv_2)$.","conditions":"使用 $\\lambda$ 的线性.","quote":"第二步使用 $T$ 的线性, 第三步使用 $\\lambda$ 的线性."}]}]}
```
