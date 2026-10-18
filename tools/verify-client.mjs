// Offline verification for the browser half.
//
// Runs `lib/client.js` in a VM with a stub `window`/`document`, then checks the
// two things a page cannot prove cheaply and a broken build would silently ship:
// what exactly lands on the clipboard for each target, and whether `apply`
// installs its listeners and its two slot consumers.
//
// The DOM-only paths (the floating bar, a real `copy` event) are exercised in
// the running page; this suite covers the decisions behind them.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import assert from 'node:assert/strict'

const root = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(root, '..', 'lib', 'client.js'), 'utf8')

/** Minimal element: enough for `ensureStyles` and the bar factory. */
function makeElement(tag) {
  const node = {
    tagName: String(tag).toUpperCase(),
    textContent: '',
    style: {},
    className: '',
    id: '',
    isConnected: true,
    children: [],
    setAttribute(name, value) { node[name] = String(value) },
    getAttribute(name) { return node[name] ?? null },
    appendChild(child) { node.children.push(child); return child },
    append(child) { node.children.push(child) },
    addEventListener() {},
    removeEventListener() {},
    remove() {},
    querySelector() { return null },
    closest() { return null },
    matches() { return false },
    getBoundingClientRect() { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 } },
  }
  return node
}

const docListeners = new Set()
const winListeners = new Set()

const documentStub = {
  body: makeElement('body'),
  head: makeElement('head'),
  activeElement: null,
  documentElement: makeElement('html'),
  getElementById: () => null,
  createElement: (tag) => makeElement(tag),
  createTextNode: (text) => ({ nodeType: 3, textContent: String(text) }),
  addEventListener: (type) => { docListeners.add(type) },
  removeEventListener: (type) => { docListeners.delete(type) },
  getSelection: () => null,
  querySelectorAll: () => [],
  execCommand: () => true,
}

const windowStub = {
  innerWidth: 1200,
  innerHeight: 800,
  addEventListener: (type) => { winListeners.add(type) },
  removeEventListener: (type) => { winListeners.delete(type) },
}

let registration = null
windowStub.__ModuleLoader__ = {
  load(definition) { registration = definition },
}

const storage = new Map()
const context = vm.createContext({
  window: windowStub,
  document: documentStub,
  navigator: {},
  console,
  setTimeout,
  clearTimeout,
  localStorage: {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => { storage.set(key, String(value)) },
  },
})

vm.runInContext(source, context, { filename: 'lib/client.js' })

assert.ok(registration !== null, 'client.js registered no module with the loader')
assert.equal(registration.id, 'dsh-math-copy', 'module id must equal the package name')

const plugin = registration.factory(() => ({}))
assert.equal(typeof plugin.apply, 'function', 'plugin exposes no apply()')
assert.deepEqual([...plugin.inject], ['slots'], 'plugin must inject the slots service')

const { formatTeX, texOf, isDisplay } = plugin.__test

// ---- clipboard payloads ----------------------------------------------------
assert.equal(formatTeX('x^2', false, 'obsidian'), '$x^2$', 'inline Obsidian')
assert.equal(formatTeX('x^2', true, 'obsidian'), '$$\nx^2\n$$', 'display Obsidian')
assert.equal(formatTeX('x^2', false, 'latex'), '\\(x^2\\)', 'inline LaTeX')
assert.equal(formatTeX('x^2', true, 'latex'), '\\[\nx^2\n\\]', 'display LaTeX')
assert.equal(formatTeX('  x^2  ', true, 'tex'), 'x^2', 'raw TeX trims and drops delimiters')
assert.equal(
  formatTeX('\\begin{aligned}a&=b\\\\c&=d\\end{aligned}', true, 'obsidian'),
  '$$\n\\begin{aligned}a&=b\\\\c&=d\\end{aligned}\n$$',
  'multi-line environments survive intact',
)

// ---- source extraction -----------------------------------------------------
const goodFormula = { querySelector: () => ({ textContent: '\\frac{a}{b}' }) }
assert.equal(texOf(goodFormula), '\\frac{a}{b}', 'annotation text is the source')
assert.equal(texOf({ querySelector: () => null }), null, 'no annotation means no source')
assert.equal(texOf({ querySelector: () => ({ textContent: '   ' }) }), null, 'blank annotation has no source')
assert.equal(texOf(null), null, 'a missing element has no source')

assert.equal(isDisplay({ closest: () => ({}) }), true, 'inside .katex-display is block math')
assert.equal(isDisplay({ closest: () => null, parentElement: null }), false, 'a bare formula is inline')

// ---- apply() wiring --------------------------------------------------------
const registeredSlots = []
const ctx = {
  slots: {
    inject(slot, callback) {
      registeredSlots.push(slot)
      const disposer = callback()
      return typeof disposer === 'function' ? disposer : () => {}
    },
    register() { return () => {} },
  },
  effect(run) {
    const disposer = run()
    return typeof disposer === 'function' ? disposer : () => {}
  },
}

plugin.apply(ctx)

assert.deepEqual(
  registeredSlots.sort(),
  ['conversation.composer.dock', 'conversation.session.header.utilities'],
  'both consumer slots are requested',
)
for (const type of ['pointerover', 'pointerout', 'copy', 'keydown']) {
  assert.ok(docListeners.has(type), `document listener missing: ${type}`)
}
for (const type of ['scroll', 'resize']) {
  assert.ok(winListeners.has(type), `window listener missing: ${type}`)
}

console.log('verify-client: all assertions passed')
