# 0.1.0

首个公开版本。把 DSH 回答里的 KaTeX 公式复制成能在 Obsidian / LaTeX 里重新渲染的 TeX。

- 悬停任意公式出现复制条：`Obsidian`（`$…$` / `$$…$$`）、`LaTeX`（`\(…\)` / `\[…\]`）、`TeX`（只要源码，一次性，不改后续格式）。
- 选中带公式的一段文本再 Ctrl+C：剪贴板里是这段文字，公式被还原成源码；选中里没有公式时完全不插手。
- 源码取自 KaTeX 的 MathML `annotation[encoding="application/x-tex"]`，不是从字形反推；多行环境（`\begin{aligned}` 等）原样保留。
- 只往页面上追加自己的浮条与提示，不动对话 DOM；卸载时全部移除。

验证：VM + stub DOM 的离线套件，以及无头 Edge 里 20 条浏览器断言（浮条定位、四种载荷、选区还原、无公式不拦截、滚动收起）。

安装：`dsh plugin --profile desktop add link:<本仓库路径>`，刷新页面即可；改客户端代码后刷新页面生效。
