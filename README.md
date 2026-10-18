# dsh-math-copy

[![ci](https://github.com/SOH4C4759/dsh-math-copy/actions/workflows/ci.yml/badge.svg)](https://github.com/SOH4C4759/dsh-math-copy/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> 视频讲解：[把 DSH 里的公式复制成能重新渲染的 TeX](https://www.bilibili.com/video/BV1CVn36REec)（91 秒）

把 DSH 回答里的数学公式，复制成 **能在 Obsidian / LaTeX 里重新渲染的 TeX**，而不是一堆字形。

回答里的公式是 KaTeX 画出来的：看得见、选得中，但 Ctrl+C 之后进剪贴板的是 `𝑒^𝑖𝜋+1=0` 这样的 Unicode 字形——粘进 Obsidian 只会得到一行怪符号。这个插件把公式还原成源码：

- **悬停任意公式** → 浮出一个小条，三个复制目标：
  - `Obsidian` → 行内 `$…$`，独立公式 `$$…$$`
  - `LaTeX` → 行内 `\(…\)`，独立公式 `\[…\]`
  - `TeX` → 只给源码，不带定界符（一次性，不改后续格式）
- **选中带公式的一段文本再 Ctrl+C** → 剪贴板里是这段文本，其中每个公式都被还原成源码（用你上次点的 `Obsidian` / `LaTeX` 目标），整段直接粘进 Obsidian 就能渲染。
- 选中里没有公式时，插件完全不插手，复制行为与原来一致。

## 为什么源码是准的

KaTeX 渲染时会在视觉标记旁边同时输出 MathML，里面带一个
`<annotation encoding="application/x-tex">`，内容就是模型写的那段 TeX 原文。
插件只读这个 annotation，不猜、不从字形反推：

- 拿不到 annotation 的公式（渲染失败、被裁掉的节点）不会出现复制条，选中路径也会跳过它；
- 支持多行环境（`\begin{aligned}…\end{aligned}` 原样保留）；
- 不修改对话 DOM，只往页面上追加自己的浮条和提示，卸载时全部移除。

上次用过的目标记在 `localStorage['dsh.math-copy.format']`，默认 `obsidian`。
`TeX` 按钮故意不写入这个记录：临时要源码，不该把「整段还原」也变成裸源码。

## 安装

```powershell
dsh plugin --profile desktop add link:<本仓库绝对路径>
```

也可以从 DSH 的插件页安装同一个路径。装好后 profile 里是这一行：

```yaml
- insert:
    - id: math-copy
      name: dsh-math-copy
```

装完插件即可用。**改过 `lib/client.js` 之后要刷新页面**（浏览器端 bundle 是页面启动时
import 的）；改 Host 半边才需要重启 DSH。

## 开发与验证

```powershell
node build-client.mjs        # src/client.js -> lib/client.js（校验 loader shell）
node --check lib/client.js
node tools/verify-client.mjs # VM + stub DOM：剪贴板载荷、annotation 提取、apply 接线
node tools/harness-run.mjs   # 无头 Edge + CDP：真的把公式 DOM 建出来跑一遍
```

`node` 不在 PATH 上时用 DSH 自带那一份：

```powershell
& "$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" tools\harness-run.mjs
```

没有 Edge 时 harness 会打印 `SKIP` 与原因（不会被当成通过）。

| 路径 | 是什么 |
|---|---|
| `entry.js` | Host 半边，空的：复制公式是页面的事，不需要路由、进程或设置项。 |
| `src/client.js` | 真正的实现（悬停浮条、选区还原、剪贴板回退、提示）。 |
| `lib/client.js` | 构建产物，由 `build-client.mjs` 从源码复制并校验；CI 会验证它与源码一致。 |
| `tools/verify-client.mjs` | 在 VM 里跑纯逻辑：三种目标的剪贴板载荷、annotation 提取、`apply()` 的监听与两个空槽位消费者。 |
| `tools/harness.html` + `tools/harness-run.mjs` | 用真实 KaTeX 结构造出公式，在无头 Edge 里跑 20 条断言：浮条出现/定位/不自动关闭、四种载荷、选区还原（含「无公式不拦截」）、滚动收起。`--dump-dom` 在本机对 HTML 页面返回空，所以改用 CDP 读页面结果。 |
| `tools/serve.mjs` | 单独起一个静态服务调试 harness 用。 |

CI（`.github/workflows/ci.yml`）跑语法检查、产物一致性、离线套件与浏览器 harness；
`.github/workflows/release.yml` 在 `v*` tag 或手动触发时打包 zip + npm tarball、在解包产物上
重跑离线套件，再发 Release。

## 已知边界

- 依赖 KaTeX 的 `.katex` / `.katex-display` 类名（KaTeX 自己的稳定契约），不依赖
  DSH 的 CSS Modules 哈希类名。
- 选区还原只在 `copy` 事件上生效；页面自己的「复制消息」按钮走
  `navigator.clipboard.writeText`，不经过这个事件——但它复制的是原始 markdown，
  本来就带 `$$`，不需要转换。
- 行内公式按 `$…$` 复制。源码里自带 `$` 的极端写法不做转义。
- 浮条靠悬停出现，纯键盘操作暂时取不到；需要的话可以再加一个消息级「复制全部公式」动作。

## 许可

[MIT](LICENSE)。
