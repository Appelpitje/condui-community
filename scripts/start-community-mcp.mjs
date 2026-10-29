import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { assertSupportedNodeVersion } from './verify-node-version.mjs'

assertSupportedNodeVersion()

// Keep the local editor and MCP client on the same storage and loopback endpoint.
if (!process.env.CONDUI_DATA_DIR?.trim()) {
  const directory = fileURLToPath(new URL('../condui-data/', import.meta.url))
  mkdirSync(directory, { recursive: true })
  process.env.CONDUI_DATA_DIR = directory
}
process.env.HOST ??= '127.0.0.1'
process.env.PORT ??= '8090'

await import('../apps/app/community/server.mjs')
