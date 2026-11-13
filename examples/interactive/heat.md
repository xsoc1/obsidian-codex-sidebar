---
title: 可调参数图：一个热方程解
tags: [codex-sidebar/example]
---

# 一个热方程解

设 $0\le x\le\pi$, $t\ge0$. 取

$$
u(x,t)=e^{-t}\sin x.
$$

这里 $x$ 是空间位置, $t$ 是时间. 直接求导得

$$
u_t=-e^{-t}\sin x,\qquad
u_{xx}=-e^{-t}\sin x.
$$

因此 $u_t=u_{xx}$. 又有 $u(0,t)=u(\pi,t)=0$, 而 $u(x,0)=\sin x$. 这就核对了方程、边界条件和初始条件. 此计算给出这个初边值问题的一个解; 一般唯一性需要另行证明.

固定 $x$ 后, 随 $t$ 增大, 因子 $e^{-t}$ 衰减; 两端的零值不变. 下图只展示这个具体解.

```codex-ui
{"schemaVersion":1,"plots":[{"id":"heat","title":"随时间衰减","expression":"exp(-t)*sin(x)","x":{"min":0,"max":3.141592653589793},"y":{"min":0,"max":1},"parameters":[{"name":"t","label":"时间 t","min":0,"max":5,"step":0.1,"value":0}],"caption":"固定纵轴便于比较振幅. 这是具体解的图示, 不代替一般证明."}],"symbols":[{"id":"time","symbol":"$t$","meaning":"时间参数. 对每个固定的 $x$, 增大 $t$ 会减小振幅因子 $e^{-t}$.","conditions":"$t\\ge0$.","quote":"设 $0\\le x\\le\\pi$, $t\\ge0$."},{"id":"boundary","symbol":"$u(0,t)=u(\\pi,t)=0$","meaning":"两端的温度偏离量固定为零, 是这个例子的 Dirichlet 边界条件.","conditions":"对所有 $t\\ge0$ 成立; 它不代替初始条件 $u(x,0)=\\sin x$.","quote":"又有 $u(0,t)=u(\\pi,t)=0$"}]}
```
