// Publish lib/client.js from src/client.js.
//
// This half is a Cordis plugin OBJECT (`{ name, inject, apply }`) rather than an
// `exports.apply` function, so the `window.__ModuleLoader__.load(...)` shell is
// part of the source and the build is a validated copy — a bare file dropped in
// by mistake is refused instead of being shipped unwrapped.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const id = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name
const source = readFileSync(join(root, 'src', 'client.js'), 'utf8')

if (!source.includes('window.__ModuleLoader__.load({')) {
  throw new Error('build-client: src/client.js must carry its own loader shell (this half returns a plugin object)')
}
if (!source.includes(`id: ${JSON.stringify(id)}`) && !source.includes(`id: '${id}'`)) {
  throw new Error(`build-client: src/client.js does not register the module id ${id}`)
}

mkdirSync(join(root, 'lib'), { recursive: true })
writeFileSync(join(root, 'lib', 'client.js'), source)
console.log(`build-client: lib/client.js written (${String(source.length)} chars)`)
