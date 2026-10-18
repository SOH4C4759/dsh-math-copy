// Minimal static server for the browser harness.
//
// Edge's headless `--dump-dom` refuses `file://` in this environment, so the
// harness is served over loopback instead. Listens on an ephemeral port and
// prints it, so a caller can start it, read the port, and navigate.
//
// Usage: node tools/serve.mjs [rootDir]
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url)))
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
}

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

server.listen(0, '127.0.0.1', () => {
  console.log(String(server.address().port))
})
