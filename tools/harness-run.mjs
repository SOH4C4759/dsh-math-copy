// Run tools/harness.html in headless Edge and print what the harness asserted.
//
// `--dump-dom` proved unreliable here (it returns nothing for HTML pages while
// still working for JSON), so this drives the page over the DevTools Protocol
// instead: serve the repo over loopback, open the harness, and read the results
// the page wrote into `#out`.
//
// Usage: node tools/harness-run.mjs
// Env:   EDGE_PATH overrides the browser executable.
import http from 'node:http'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const EDGE = process.env.EDGE_PATH
  ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

/** Serve the repository root on an ephemeral loopback port. */
function startServer() {
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent((req.url ?? '/').split('?')[0])
    const file = normalize(join(root, pathname))
    if (!file.startsWith(root)) {
      res.writeHead(403)
      res.end('forbidden')
      return
    }
    readFile(file).then((body) => {
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
      res.end(body)
    }).catch(() => {
      res.writeHead(404)
      res.end('not found')
    })
  })
  return new Promise((done) => {
    server.listen(0, '127.0.0.1', () => done({ server, port: server.address().port }))
  })
}

/** Minimal CDP client over Node's global WebSocket. */
function connect(url) {
  const socket = new WebSocket(url)
  const pending = new Map()
  const listeners = new Set()
  let nextId = 1

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    if (message.id !== undefined) {
      const entry = pending.get(message.id)
      if (entry !== undefined) {
        pending.delete(message.id)
        if (message.error) entry.reject(new Error(JSON.stringify(message.error)))
        else entry.resolve(message.result)
      }
      return
    }
    for (const listener of listeners) listener(message)
  })

  const ready = new Promise((done, fail) => {
    socket.addEventListener('open', () => done())
    socket.addEventListener('error', () => fail(new Error('CDP socket failed')))
  })

  return {
    ready,
    send(method, params = {}) {
      const id = nextId++
      return new Promise((resolvePromise, rejectPromise) => {
        pending.set(id, { resolve: resolvePromise, reject: rejectPromise })
        socket.send(JSON.stringify({ id, method, params }))
      })
    },
    on(listener) { listeners.add(listener) },
    close() { socket.close() },
  }
}

async function main() {
  // A missing browser is the environment, not a failure: CI keeps this step
  // honest by printing SKIP with the reason instead of turning green on a
  // check that never ran.
  if (!existsSync(EDGE)) {
    console.log(`SKIP browser harness: no browser at ${EDGE}`)
    console.log('Set EDGE_PATH to a Chromium-family executable to run it.')
    return
  }
  const { server, port } = await startServer()
  const profile = await mkdtemp(join(tmpdir(), 'dsh-math-copy-edge-'))
  const debugPort = 9500 + Math.floor(Math.random() * 400)
  const browser = spawn(EDGE, [
    '--headless',
    '--disable-gpu',
    '--no-proxy-server',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${debugPort}`,
    'about:blank',
  ], { stdio: 'ignore' })

  let client
  try {
    let target
    for (let attempt = 0; attempt < 100 && target === undefined; attempt += 1) {
      await sleep(100)
      try {
        const list = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((r) => r.json())
        target = list.find((entry) => entry.type === 'page')
      } catch (error) {
        // DevTools endpoint not up yet.
      }
    }
    if (target === undefined) throw new Error('no DevTools page target appeared')

    client = connect(target.webSocketDebuggerUrl)
    await client.ready
    await client.send('Page.enable')
    await client.send('Runtime.enable')

    const diagnostics = []
    client.on((message) => {
      if (message.method === 'Runtime.exceptionThrown') {
        const d = message.params.exceptionDetails
        diagnostics.push('EXCEPTION ' + (d.exception?.description ?? d.text))
      }
      if (message.method === 'Runtime.consoleAPICalled') {
        diagnostics.push('CONSOLE ' + message.params.args.map((a) => a.value ?? a.description).join(' '))
      }
    })

    const loaded = new Promise((done) => {
      client.on((message) => {
        if (message.method === 'Page.loadEventFired') done()
      })
    })
    await client.send('Page.navigate', { url: `http://127.0.0.1:${port}/tools/harness.html` })
    await Promise.race([loaded, sleep(8000)])

    const evaluation = await client.send('Runtime.evaluate', {
      expression: "document.getElementById('out')?.textContent ?? '(no results node)'",
      returnByValue: true,
      awaitPromise: true,
    })
    const text = String(evaluation.result?.value ?? '')
    console.log(text)
    if (diagnostics.length > 0) console.error(diagnostics.join('\n'))
    const failures = (text.match(/^FAIL /gm) ?? []).length
    if (failures > 0 || !text.includes('RESULT')) {
      console.error(`harness-run: ${String(failures)} failing assertion(s)`)
      process.exitCode = 1
    }
  } finally {
    try { client?.close() } catch (error) { /* already closed */ }
    browser.kill()
    server.close()
    await sleep(300)
    await rm(profile, { recursive: true, force: true }).catch(() => {})
  }
}

await main()

