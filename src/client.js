// dsh-math-copy — browser half.
//
// One rule: a formula leaves DSH as TeX, not as glyphs.
//
//   - Hover any rendered formula: a small bar appears with three copy targets.
//     `Obsidian` copies `$…$` / `$$…$$`, `LaTeX` copies `\(…\)` / `\[…\]`,
//     `TeX` copies the source with no delimiters.
//   - Ctrl+C on a selection that contains formulas: the clipboard receives the
//     selection text with every rendered formula restored to its source, in the
//     last used target. Selecting half an answer and pasting it into Obsidian
//     therefore produces a renderable formula instead of `𝑒^𝑖𝜋+1=0`.
//
// The source is not guessed. The harness renders math with KaTeX, which emits
// MathML beside the visual markup, and its
// `<annotation encoding="application/x-tex">` holds the exact TeX the model
// wrote. That annotation is the only input this plugin trusts; a formula whose
// source cannot be read simply gets no copy bar, and the selection path leaves
// it alone.
//
// The plugin never rewrites the transcript. It owns two nodes of its own (the
// floating bar and the toast), both removed on dispose.

;(function () {
  'use strict'

  window.__ModuleLoader__.load({
    id: 'dsh-math-copy',
    factory(require) {
      const FORMATS = ['obsidian', 'latex', 'tex']
      const FORMAT_LABEL = { obsidian: 'Obsidian', latex: 'LaTeX', tex: 'TeX' }
      const STORE_KEY = 'dsh.math-copy.format'
      const STYLE_ID = 'dsh-math-copy-styles'
      const ANNOTATION = 'annotation[encoding="application/x-tex"]'
      const HIDE_DELAY_MS = 180
      const TOAST_MS = 1700
      const FONT_SANS = '-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif'

      const CSS = `
.dmc-bar {
  position: fixed; z-index: 2147482000; display: flex; align-items: center; gap: 2px;
  box-sizing: border-box; padding: 3px; border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l1, #d9d9de);
  background: var(--dsw-alias-bg-overlay, #ffffff);
  color: var(--dsw-alias-label-secondary, #4c5057);
  box-shadow: 0 4px 16px rgb(0 0 0 / 16%);
  font: 500 11.5px/1.4 var(--dsw-font-sans, ${FONT_SANS});
  opacity: 0; pointer-events: none; transition: opacity .12s ease; user-select: none;
}
.dmc-bar[data-open="1"] { opacity: 1; pointer-events: auto; }
.dmc-btn {
  appearance: none; border: 0; background: none; padding: 4px 7px; border-radius: 6px;
  font: inherit; color: inherit; cursor: pointer; white-space: nowrap;
}
.dmc-btn:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgb(0 0 0 / 7%));
  color: var(--dsw-alias-label-primary, #1f2328);
}
.dmc-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #4f9dd9); outline-offset: -1px; }
.dmc-toast {
  position: fixed; left: 50%; bottom: 26px; transform: translateX(-50%); z-index: 2147482000;
  box-sizing: border-box; max-width: calc(100vw - 32px); padding: 7px 14px; border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l1, #d9d9de);
  background: var(--dsw-alias-bg-overlay, #ffffff); color: var(--dsw-alias-label-primary, #1f2328);
  box-shadow: 0 6px 20px rgb(0 0 0 / 18%);
  font: 500 12px/1.5 var(--dsw-font-sans, ${FONT_SANS});
  opacity: 0; pointer-events: none; transition: opacity .16s ease;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.dmc-toast[data-open="1"] { opacity: 1; }
`

      /** Everything this half owns. `current` is the formula the bar points at. */
      const state = {
        format: readFormat(),
        current: null,
        bar: null,
        toast: null,
        hideTimer: 0,
        toastTimer: 0,
        bound: false,
      }

      // ------------------------------------------------------------ formats ---

      /** The last target used, or Obsidian for a fresh install. */
      function readFormat() {
        try {
          const stored = globalThis.localStorage?.getItem(STORE_KEY)
          if (typeof stored === 'string' && FORMATS.includes(stored)) return stored
        } catch (error) {
          // Storage denied (private mode, hardened profile): the default stands.
        }
        return 'obsidian'
      }

      /** Remember the target so the selection path agrees with the last click. */
      function saveFormat(format) {
        state.format = format
        try {
          globalThis.localStorage?.setItem(STORE_KEY, format)
        } catch (error) {
          // A preference that cannot be stored is still a preference in this page.
        }
      }

      /**
       * The TeX source of one rendered formula.
       * @param katex - a `.katex` root.
       * @returns the source, or null when KaTeX kept none (a failed render).
       */
      function texOf(katex) {
        if (katex === null || katex === undefined || typeof katex.querySelector !== 'function') return null
        const annotation = katex.querySelector(ANNOTATION)
        if (annotation === null || annotation === undefined) return null
        const text = annotation.textContent
        return typeof text === 'string' && text.trim() !== '' ? text : null
      }

      /** Whether this formula is block math (KaTeX wraps it in `.katex-display`). */
      function isDisplay(katex) {
        if (katex === null || katex === undefined) return false
        if (typeof katex.closest === 'function' && katex.closest('.katex-display') !== null) return true
        const parent = katex.parentElement
        return parent !== null && parent !== undefined
          && typeof parent.className === 'string'
          && parent.className.split(/\s+/).includes('katex-display')
      }

      /**
       * Render one source in the requested target.
       *
       * Obsidian and LaTeX share no delimiter convention worth betting on: the
       * vault wants `$…$` / `$$…$$`, a paper wants `\(…\)` / `\[…\]`, and both
       * render either one only by accident. `tex` exists for the case where the
       * caller has its own wrapper.
       * @param tex - source text.
       * @param display - block math rather than inline.
       * @param format - one of FORMATS.
       * @returns the exact clipboard payload.
       */
      function formatTeX(tex, display, format) {
        const body = String(tex).trim()
        if (format === 'tex') return body
        if (format === 'latex') return display ? `\\[\n${body}\n\\]` : `\\(${body}\\)`
        return display ? `$$\n${body}\n$$` : `$${body}$`
      }

      // -------------------------------------------------------------- shell ---

      /** Inject the stylesheet once per document, tagged with this package. */
      function ensureStyles() {
        if (document.getElementById(STYLE_ID) !== null) return
        const style = document.createElement('style')
        style.id = STYLE_ID
        style.setAttribute('data-plugin', 'dsh-math-copy')
        style.setAttribute('data-plugin-css', STYLE_ID)
        style.textContent = CSS
        document.head.append(style)
      }

      /** One bar for the whole page: it only ever moves and retargets. */
      function createBar() {
        const bar = document.createElement('div')
        bar.className = 'dmc-bar'
        bar.setAttribute('data-dmc-bar', '1')
        bar.setAttribute('data-open', '0')
        bar.setAttribute('role', 'toolbar')
        bar.setAttribute('aria-label', '复制公式')
        for (const format of FORMATS) {
          const button = document.createElement('button')
          button.type = 'button'
          button.className = 'dmc-btn'
          button.setAttribute('data-format', format)
          button.textContent = FORMAT_LABEL[format]
          button.title = format === 'obsidian'
            ? '复制为 Obsidian 公式：$…$（行内）/ $$…$$（独立成段）'
            : format === 'latex'
              ? '复制为 LaTeX 公式：\\(…\\)（行内）/ \\[…\\]（独立成段）'
              : '只复制 TeX 源码，不带定界符'
          bar.appendChild(button)
          button.addEventListener('pointerenter', cancelHide)
        }
        // A press on the bar must not clear the page selection, and it must not
        // reach the transcript underneath it.
        bar.addEventListener('pointerdown', (event) => {
          event.stopPropagation()
          if (event.target instanceof Element && event.target.closest('.dmc-btn') !== null) event.preventDefault()
        })
        bar.addEventListener('pointerenter', cancelHide)
        bar.addEventListener('pointerleave', scheduleHide)
        bar.addEventListener('click', onBarClick)
        document.body.appendChild(bar)
        return bar
      }

      /** Point the bar at one formula and place it clear of the formula's box. */
      function showBar(katex) {
        if (state.bar === null) state.bar = createBar()
        const bar = state.bar
        state.current = katex
        bar.setAttribute('data-open', '1')

        const rect = katex.getBoundingClientRect()
        // Measured while visible: layout still runs with opacity 0, so the size
        // is known before the first paint of this position.
        const width = bar.offsetWidth || 132
        const height = bar.offsetHeight || 26
        let top = rect.top - height - 6
        if (top < 6) top = rect.bottom + 6
        const left = Math.max(6, Math.min(rect.right - width, window.innerWidth - width - 6))
        bar.style.top = `${Math.round(top)}px`
        bar.style.left = `${Math.round(left)}px`
      }

      function cancelHide() {
        if (state.hideTimer !== 0) {
          clearTimeout(state.hideTimer)
          state.hideTimer = 0
        }
      }

      /**
       * Hide after a short grace period.
       *
       * The grace exists because the bar floats outside the formula's box: the
       * pointer has to cross empty space to reach it, and an immediate hide would
       * make the bar impossible to click.
       */
      function scheduleHide() {
        cancelHide()
        state.hideTimer = setTimeout(() => {
          state.hideTimer = 0
          if (state.bar !== null && state.bar.matches(':hover')) return
          hideBar()
        }, HIDE_DELAY_MS)
      }

      function hideBar() {
        cancelHide()
        state.current = null
        state.bar?.setAttribute('data-open', '0')
      }

      // ------------------------------------------------------------- events ---

      function onPointerOver(event) {
        const target = event.target
        if (!(target instanceof Element)) return
        const katex = target.closest('.katex')
        if (katex === null) return
        if (texOf(katex) === null) return
        cancelHide()
        if (state.current !== katex) showBar(katex)
      }

      function onPointerOut(event) {
        const target = event.target
        if (!(target instanceof Element)) return
        const katex = target.closest('.katex')
        if (katex === null || katex !== state.current) return
        const related = event.relatedTarget
        if (related instanceof Node
          && (katex.contains(related) || (state.bar !== null && state.bar.contains(related)))) return
        scheduleHide()
      }

      function onBarClick(event) {
        const target = event.target
        if (!(target instanceof Element)) return
        const button = target.closest('.dmc-btn')
        if (button === null) return
        const katex = state.current
        if (katex === null || katex.isConnected !== true) {
          hideBar()
          return
        }
        const format = button.getAttribute('data-format')
        const tex = texOf(katex)
        if (tex === null || typeof format !== 'string' || !FORMATS.includes(format)) return
        // `tex` is a one-off: it copies the source and leaves the document
        // format alone, so a later selection is still restored as `$…$` /
        // `$$…$$` rather than as bare source.
        if (format !== 'tex') saveFormat(format)
        const payload = formatTeX(tex, isDisplay(katex), format)
        // The bar stays open on purpose: copying the same formula in a second
        // target is the common next move, and hiding under the pointer would
        // make the user re-hover the formula to do it.
        void copyText(payload).then(() => {
          toast(`已复制 ${FORMAT_LABEL[format]} 公式`)
        }).catch((error) => {
          console.warn('[math-copy] clipboard write failed:', error)
        })
      }

      function onScroll() {
        if (state.current !== null) hideBar()
      }

      function onKeyDown(event) {
        if (event.key === 'Escape') hideBar()
      }

      /**
       * Replace rendered formulas inside a selected range with their source.
       *
       * A selection that carries no formula is left completely alone: the event
       * is not cancelled, and the browser's own copy runs. Only a selection that
       * would otherwise paste as glyph soup is rewritten.
       */
      function onCopy(event) {
        if (event.clipboardData === null || event.clipboardData === undefined) return

        const selection = document.getSelection()
        if (selection === null || selection === undefined) return
        if (selection.isCollapsed || selection.rangeCount === 0) return

        // Decide by where the selection IS, not by where focus is: clicking a
        // paragraph in the transcript does not necessarily blur the composer,
        // so `document.activeElement` would refuse copies that the user means.
        const anchor = selection.anchorNode
        const anchorElement = anchor instanceof Element ? anchor : anchor?.parentElement
        if (anchorElement instanceof Element
          && anchorElement.closest('input, textarea, [contenteditable="true"]') !== null) return

        let fragment
        try {
          fragment = selection.getRangeAt(0).cloneContents()
        } catch (error) {
          return
        }
        if (fragment.querySelector('.katex') === null) return

        const text = fragmentText(fragment, state.format)
        if (text === '') return
        try {
          event.clipboardData.setData('text/plain', text)
        } catch (error) {
          return
        }
        event.preventDefault()
      }

      /**
       * Flatten a cloned range to text with formulas restored.
       *
       * The fragment is mounted off-screen so `innerText` can turn block
       * boundaries into newlines the way the page lays them out; `textContent`
       * is the fallback for an engine that has no `innerText` on a detached
       * subtree.
       */
      function fragmentText(fragment, format) {
        for (const katex of fragment.querySelectorAll('.katex')) {
          const tex = texOf(katex)
          if (tex === null) continue
          katex.replaceWith(document.createTextNode(formatTeX(tex, isDisplay(katex), format)))
        }
        const holder = document.createElement('div')
        holder.setAttribute('aria-hidden', 'true')
        holder.style.cssText = 'position:fixed;top:0;left:-100000px;width:70ch;white-space:pre-wrap;'
        holder.appendChild(fragment)
        document.body.appendChild(holder)
        let text = ''
        try {
          text = typeof holder.innerText === 'string' ? holder.innerText : (holder.textContent ?? '')
        } finally {
          holder.remove()
        }
        return text.replace(/\u00a0/g, ' ')
      }

      // ----------------------------------------------------------- clipboard ---

      /** Write to the clipboard, falling back to a selection copy. */
      function copyText(text) {
        const clipboard = navigator.clipboard
        if (clipboard !== null && clipboard !== undefined && typeof clipboard.writeText === 'function') {
          return clipboard.writeText(text).catch(() => { legacyCopy(text) })
        }
        try {
          legacyCopy(text)
        } catch (error) {
          return Promise.reject(error)
        }
        return Promise.resolve()
      }

      function legacyCopy(text) {
        const area = document.createElement('textarea')
        area.value = text
        area.setAttribute('readonly', '')
        area.style.cssText = 'position:fixed;top:0;left:-100000px;opacity:0;'
        document.body.appendChild(area)
        area.select()
        try {
          document.execCommand('copy')
        } finally {
          area.remove()
        }
      }

      /** One pill at the bottom edge confirms the copy without stealing focus. */
      function toast(message) {
        if (state.toast === null) {
          const node = document.createElement('div')
          node.className = 'dmc-toast'
          node.setAttribute('data-dmc-toast', '1')
          node.setAttribute('role', 'status')
          node.setAttribute('aria-live', 'polite')
          node.setAttribute('data-open', '0')
          document.body.appendChild(node)
          state.toast = node
        }
        state.toast.textContent = message
        state.toast.setAttribute('data-open', '1')
        if (state.toastTimer !== 0) clearTimeout(state.toastTimer)
        state.toastTimer = setTimeout(() => {
          state.toastTimer = 0
          state.toast?.setAttribute('data-open', '0')
        }, TOAST_MS)
      }

      // ----------------------------------------------------------- lifecycle ---

      function bind() {
        if (state.bound) return
        state.bound = true
        document.addEventListener('pointerover', onPointerOver, true)
        document.addEventListener('pointerout', onPointerOut, true)
        document.addEventListener('copy', onCopy, true)
        document.addEventListener('keydown', onKeyDown, true)
        window.addEventListener('scroll', onScroll, true)
        window.addEventListener('resize', onScroll)
      }

      function unbind() {
        if (!state.bound) return
        state.bound = false
        document.removeEventListener('pointerover', onPointerOver, true)
        document.removeEventListener('pointerout', onPointerOut, true)
        document.removeEventListener('copy', onCopy, true)
        document.removeEventListener('keydown', onKeyDown, true)
        window.removeEventListener('scroll', onScroll, true)
        window.removeEventListener('resize', onScroll)
        cancelHide()
        if (state.toastTimer !== 0) {
          clearTimeout(state.toastTimer)
          state.toastTimer = 0
        }
        state.current = null
        state.bar?.remove()
        state.bar = null
        state.toast?.remove()
        state.toast = null
        document.getElementById(STYLE_ID)?.remove()
      }

      /**
       * The client module system runs a plugin's side effects only once
       * something uses it, so the two empty registrations below are the
       * consumer: they render nothing and exist to keep `apply` alive in the
       * page for as long as the session has a header or a composer.
       */
      function registerConsumers(ctx) {
        for (const slot of ['conversation.session.header.utilities', 'conversation.composer.dock']) {
          try {
            ctx.effect(
              () => ctx.slots.inject(slot, () => ctx.slots.register(
                { name: slot, id: 'math-copy', order: 60 },
                () => null,
              )),
              `math-copy: ${slot} consumer`,
            )
          } catch (error) {
            console.warn('[math-copy] slot registration failed:', slot, error)
          }
        }
      }

      return {
        name: 'ui-math-copy',
        inject: ['slots'],
        apply(ctx) {
          ensureStyles()
          bind()
          registerConsumers(ctx)
          ctx.effect(() => () => { unbind() }, 'math-copy: listeners')
        },
        // Exposed for the offline verification suite: the pure decisions that
        // decide what lands on the clipboard, tested without a browser.
        __test: { formatTeX, texOf, isDisplay, readFormat, FORMATS, FORMAT_LABEL },
      }
    },
  })
})()
