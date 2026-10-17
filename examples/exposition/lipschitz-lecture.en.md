---
title: "Lipschitz Continuity and Uniform Continuity"
fixture: H08
model: gpt-6.1-sol
effort: low
fast: false
skill_version: "0.3.0-candidate.3"
review: "author AI reading; no independent or learner acceptance"
---

# Lipschitz Continuity and Uniform Continuity

A bound on how much a function changes can provide a single input tolerance that works throughout its domain. We will compute such a bound for $f(x)=2x+1$ and then prove the general implication.

We use real numbers, elementary algebra, and absolute values. Recall that $|x-y|$ is the distance between real numbers $x$ and $y$, and $|ab|=|a||b|$. The calculation below shows explicitly how these rules apply; no prior knowledge of continuity is required.

## Lipschitz continuity

Let $D\subseteq\mathbb R$ and let $f:D\to\mathbb R$ be a function. We say that $f$ is **Lipschitz continuous on $D$** if there exists a finite real constant $L\ge0$ such that

$$
|f(x)-f(y)|\le L|x-y|\qquad\text{for every }x,y\in D.
$$

Such an $L$ is called a **Lipschitz constant** for $f$ on $D$. The same constant must work for every pair of points in the domain. It bounds output distance by a fixed multiple of input distance.

^h08-def-lipschitz

## First calculation: an affine function

Consider $f:\mathbb R\to\mathbb R$ defined by $f(x)=2x+1$. For arbitrary $x,y\in\mathbb R$,

$$
\begin{aligned}
|f(x)-f(y)|
&=|(2x+1)-(2y+1)|\\
&=|2x-2y|\\
&=|2(x-y)|\\
&=2|x-y|.
\end{aligned}
$$

Thus $f$ is Lipschitz continuous on all of $\mathbb R$, with Lipschitz constant $L=2$. The constant term cancels when we subtract the outputs, and the factor $2$ multiplies every input distance by exactly $2$.

For instance, if we want $|f(x)-f(y)|<0.1$, it suffices to require $|x-y|<0.05$, because then

$$
|f(x)-f(y)|=2|x-y|<2(0.05)=0.1.
$$

This requirement works wherever $x$ and $y$ lie on the real line.

^h08-example-affine

## Uniform continuity

Let $D\subseteq\mathbb R$ and $f:D\to\mathbb R$. We say that $f$ is **uniformly continuous on $D$** if, for every real number $\varepsilon>0$, there exists a real number $\delta>0$ such that, for all $x,y\in D$,

$$
|x-y|<\delta\quad\Longrightarrow\quad|f(x)-f(y)|<\varepsilon.
$$

Here $\varepsilon$ specifies the allowed output error, and $\delta$ specifies a sufficient input tolerance. The quantifier order is

$$
\forall\varepsilon>0\;\exists\delta>0\;\forall x,y\in D,
\qquad
|x-y|<\delta\Longrightarrow|f(x)-f(y)|<\varepsilon.
$$

In particular, we choose $\delta$ before choosing $x$ and $y$. It may depend on $\varepsilon$ and the fixed function and domain, but it must work for every pair of domain points.

^h08-def-uniform-continuity

## A Lipschitz bound gives uniform continuity

**Theorem.** Let $D\subseteq\mathbb R$ and let $f:D\to\mathbb R$. Suppose there exists a finite real constant $L\ge0$ such that

$$
|f(x)-f(y)|\le L|x-y|\qquad\text{for all }x,y\in D.
$$

Then $f$ is uniformly continuous on $D$.

^h08-thm-lipschitz-uniform

**Proof.** Fix an arbitrary real number $\varepsilon>0$. We must find one $\delta>0$ that works for every $x,y\in D$.

First suppose $L>0$. Choose

$$
\delta=\frac{\varepsilon}{L}.
$$

This is positive because both $\varepsilon$ and $L$ are positive. Now let $x,y\in D$ be arbitrary points satisfying $|x-y|<\delta$. The Lipschitz bound gives

$$
|f(x)-f(y)|\le L|x-y|<L\delta
=L\frac{\varepsilon}{L}=\varepsilon.
$$

Thus this choice of $\delta$ works for every pair $x,y\in D$.

If $L=0$, choose $\delta=1$. For any $x,y\in D$ satisfying $|x-y|<\delta$, the assumed bound gives

$$
0\le|f(x)-f(y)|\le0|x-y|=0,
$$

so $|f(x)-f(y)|=0<\varepsilon$.

In both cases, for the arbitrary $\varepsilon>0$ we have chosen a positive $\delta$ independent of $x$ and $y$ and established the required implication for all $x,y\in D$. This is precisely uniform continuity. $\square$

## Using the result

For $f(x)=2x+1$, the first calculation supplies $L=2$. Consequently, for every $\varepsilon>0$, the choice $\delta=\varepsilon/2$ works simultaneously for all $x,y\in\mathbb R$. No restriction to a bounded interval is needed.

The method is to estimate $|f(x)-f(y)|$ by a fixed multiple of $|x-y|$, then convert the desired output tolerance into an input tolerance.

> [!tip] Recall from memory
> Why must the Lipschitz constant be independent of $x$ and $y$? In the proof, where does that independence ensure that a single $\delta$ works throughout $D$? Why does the case $L=0$ require a separate choice?

^h08-recall

**Source attribution.** Based on *H08 original source*, “Original supplementary source E8,” supplied snapshot dated 2026-10-18. That source provides the example $f(x)=2x+1$ on $\mathbb R$ and the assertion that a finite Lipschitz bound with $L\ge0$ implies uniform continuity. The definitions, worked calculation, and quantified proof above expand that material into a standalone lecture section.

^h08-source
