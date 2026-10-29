import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createStorage } from './storage.mjs'

const root = fileURLToPath(new URL('../../../', import.meta.url))

async function startServer(env = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'condui-mcp-'))
  const child = spawn(process.execPath, ['apps/app/community/server.mjs'], {
    cwd: root,
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1', CONDUI_DATA_DIR: directory, CONDUI_PASSWORD: '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  child.stderr.on('data', (chunk) => { log += chunk })
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit')
      child.kill('SIGTERM')
      await exited
    }
    await rm(directory, { recursive: true, force: true })
  }
  try {
    const url = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Server startup timed out: ${log}`)), 15_000)
      const fail = (error) => { clearTimeout(timeout); reject(error) }
      child.once('error', fail)
      child.once('exit', (code) => fail(new Error(`Server exited (${code}): ${log}`)))
      child.stdout.on('data', (chunk) => {
        log += chunk
        const match = log.match(/listening on (http:\/\/[^\s]+)/)
        if (match) { clearTimeout(timeout); resolve(match[1]) }
      })
    })
    return { url, directory, stop }
  } catch (error) {
    await stop()
    throw error
  }
}

async function connect(url, headers = {}) {
  const client = new Client({ name: 'condui-integration-test', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { requestInit: { headers } }))
  return client
}

let server
let client
before(async () => { server = await startServer(); client = await connect(server.url) })
after(async () => { await client?.close(); await server?.stop() })

async function call(name, args = {}, target = client) {
  const result = await target.callTool({ name, arguments: args })
  assert.equal(result.isError, undefined, JSON.stringify(result))
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent)
  return result.structuredContent
}

const create = (name = 'MCP integration test') => call('condui_create_project', { name })
const created = (from, kind) => ({ $created: { from, kind } })
const circuitBatch = (panelId) => [
  { id: 'circuit.createEmpty', as: 'lights', input: { panelId, kind: 'lighting' } },
  { id: 'electrical.placeSymbol', input: { symbolId: 'light_point', destination: { kind: 'circuit', circuitId: created('lights', 'circuit') } } },
]
const readProject = async (id) => (await fetch(`${server.url}/api/storage/projects/${id}`)).json()

test('MCP discovery exposes commands, symbol schemas and correct write annotations', async () => {
  const { tools } = await client.listTools()
  assert.equal(tools.length, 12)
  assert.equal(tools.find((tool) => tool.name === 'condui_preview_commands').annotations.readOnlyHint, true)
  assert.equal(tools.find((tool) => tool.name === 'condui_apply_commands').annotations.destructiveHint, true)
  const { symbols } = await call('condui_list_symbols', { query: 'light_point' })
  assert.ok(symbols.some((symbol) => symbol.id === 'light_point'))
  const { commands } = await call('condui_list_commands')
  assert.ok(commands.some((command) => command.id === 'circuit.createEmpty'))
  const description = await call('condui_describe_command', { commandId: 'circuit.createEmpty', options: { detail: 'full' } })
  assert.ok(description.inputSchema.properties.panelId)
})

test('new projects are canonical documents accessible through the browser storage API', async () => {
  const result = await create('Visible in Condui')
  assert.equal(result.revision, 1)
  const stored = await readProject(result.project.id)
  assert.equal(stored.project.schemaVersion, '2.3.0')
  assert.equal(stored.project.project.name, 'Visible in Condui')
  assert.equal(stored.project.panels, undefined)
  assert.equal(stored.project.disciplines.electrical.panels[0].id, result.panels[0].id)
  assert.equal(stored.project.building.floors[0].id, result.floors[0].id)
  const list = await call('condui_list_projects', { query: 'Visible in Condui' })
  assert.equal(list.projects[0].id, result.project.id)
})

test('house workflow draws circuits, symbols, walls, plan wiring and panel layout atomically', async () => {
  const project = await create('House workflow')
  const guide = await call('condui_get_workflow')
  const commands = JSON.parse(JSON.stringify(guide.exampleBatch.commands).replaceAll('panel-id', project.panels[0].id))
  const input = { projectId: project.project.id, expectedRevision: project.revision, commands }
  const before = await readProject(input.projectId)
  const preview = await call('condui_preview_commands', input)
  assert.equal(preview.preview, true)
  assert.equal(preview.changed, true)
  assert.deepEqual(await readProject(input.projectId), before)
  const applied = await call('condui_apply_commands', input)
  assert.equal(applied.revision, 2)
  const floor = applied.results.find((result) => result.as === 'floor').created.find((ref) => ref.kind === 'floor')
  const entities = await call('condui_find_entities', { projectId: input.projectId, query: { kind: 'wall', floorId: floor.id } })
  assert.equal(entities.total, 1)
  const light = applied.results.find((result) => result.as === 'light').created.find((ref) => ref.kind === 'endpoint')
  const read = await call('condui_read_entities', { projectId: input.projectId, refs: [light] })
  assert.equal(read.entities[0].fields.symbol, 'light_point')
  const graph = await call('condui_get_graph', { projectId: input.projectId })
  assert.equal(graph.revision, 2)
  assert.ok(JSON.stringify(graph).includes(light.id))
  const validation = await call('condui_validate_project', { projectId: input.projectId, limit: 2 })
  assert.equal(validation.structure.valid, true)
  assert.ok(validation.issues.length <= 2)
  assert.ok(validation.coverage.total > 0)
  assert.deepEqual((await readProject(input.projectId)).metadata.revision, 2)
})

test('a failing dependent command leaves the entire document and revision unchanged', async () => {
  const project = await create('Atomic rollback')
  const commands = circuitBatch(project.panels[0].id)
  commands[1].input.symbolId = 'nonexistent_symbol'
  const before = await readProject(project.project.id)
  const result = await client.callTool({ name: 'condui_apply_commands', arguments: { projectId: project.project.id, expectedRevision: 1, commands } })
  assert.equal(result.isError, true)
  assert.equal(result.structuredContent.error.code, 'check_failed')
  assert.deepEqual(await readProject(project.project.id), before)
})

test('stale browser and MCP writes cannot replace each other', async () => {
  const project = await create('Revision conflicts')
  const original = await readProject(project.project.id)
  const input = { projectId: project.project.id, expectedRevision: 1, commands: circuitBatch(project.panels[0].id) }
  await call('condui_apply_commands', input)
  const stale = await client.callTool({ name: 'condui_apply_commands', arguments: input })
  assert.equal(stale.structuredContent.error.code, 'stale_revision')
  const browserSave = await fetch(`${server.url}/api/storage/projects/${project.project.id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project: original.project, baseRevision: 1 }),
  })
  assert.equal(browserSave.status, 409)
  const latest = await readProject(project.project.id)
  latest.project.project.name = 'Edited in browser'
  const freshBrowserSave = await fetch(`${server.url}/api/storage/projects/${project.project.id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project: latest.project, baseRevision: 2 }),
  })
  assert.equal(freshBrowserSave.status, 200)
  const staleAfterBrowser = await client.callTool({ name: 'condui_apply_commands', arguments: { ...input, expectedRevision: 2 } })
  assert.equal(staleAfterBrowser.structuredContent.error.code, 'stale_revision')
  assert.equal((await readProject(project.project.id)).project.project.name, 'Edited in browser')
})

test('two simultaneous MCP edits from the same revision commit exactly once', async () => {
  const project = await create('Concurrent editing')
  const input = { projectId: project.project.id, expectedRevision: 1, commands: circuitBatch(project.panels[0].id) }
  const results = await Promise.all([1, 2].map(() => client.callTool({ name: 'condui_apply_commands', arguments: input })))
  assert.equal(results.filter((result) => !result.isError).length, 1)
  assert.equal(results.find((result) => result.isError).structuredContent.error.code, 'stale_revision')
  assert.equal((await readProject(project.project.id)).metadata.revision, 2)
})

test('storage reads never pair a document with a revision from another write', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'condui-storage-test-'))
  try {
    const storage = createStorage(directory)
    await storage.putProject('race', { project: { project: { id: 'race', name: '1' } } })
    const actions = []
    for (let revision = 2; revision <= 20; revision++) {
      actions.push(storage.putProject('race', { project: { project: { id: 'race', name: String(revision) } }, baseRevision: revision - 1 }))
      actions.push(storage.getProject('race', { touch: revision % 2 === 0 }).then(({ project, metadata }) => {
        assert.equal(Number(project.project.name), metadata.revision)
      }))
    }
    await Promise.all(actions)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('MCP rejects cross-origin requests, public forwarded clients and oversized input', async () => {
  const post = (headers, body = '{}') => fetch(`${server.url}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers }, body,
  })
  assert.equal((await post({ Origin: 'https://untrusted.example' })).status, 403)
  assert.equal((await post({ Origin: 'null' })).status, 403)
  assert.equal((await post({ 'X-Forwarded-For': '203.0.113.7' })).status, 403)
  assert.equal((await post({}, JSON.stringify({ padding: 'x'.repeat(4 * 1024 * 1024) }))).status, 413)
  assert.equal((await fetch(`${server.url}/mcp`)).status, 405)
  const invalid = await client.callTool({ name: 'condui_find_entities', arguments: { projectId: '../outside' } })
  assert.equal(invalid.isError, true)
})

test('MCP uses the existing Community password guard', async () => {
  const secured = await startServer({ CONDUI_PASSWORD: 'integration-test-password' })
  let authenticated
  try {
    assert.equal((await fetch(`${secured.url}/mcp`, { method: 'POST' })).status, 401)
    authenticated = await connect(secured.url, { Authorization: `Basic ${Buffer.from(':integration-test-password').toString('base64')}` })
    assert.deepEqual((await call('condui_list_projects', {}, authenticated)).projects, [])
  } finally { await authenticated?.close(); await secured.stop() }
})

test('browser-only installations receive an actionable storage error', async () => {
  const disabled = await startServer({ CONDUI_DATA_DIR: join(tmpdir(), `missing-condui-data-${crypto.randomUUID()}`) })
  try {
    const response = await fetch(`${disabled.url}/mcp`, { method: 'POST' })
    assert.equal(response.status, 503)
    assert.match((await response.json()).error.message, /CONDUI_DATA_DIR/)
    assert.equal((await (await fetch(`${disabled.url}/api/storage`)).json()).enabled, false)
  } finally { await disabled.stop() }
})
