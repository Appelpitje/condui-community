import type { IncomingMessage, ServerResponse } from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import {
  CommandError,
  createDefaultCommandEnv,
  createHeadlessProjectSession,
  describeProjectCommand,
  describeProjectWorkflow,
  findProjectEntities,
  findProjectSymbols,
  inspectProjectGraph,
  listProjectCommands,
  projectCommands,
  projectEntityQuerySchema,
  projectEntityReadSchema,
  projectGraphQuerySchema,
  readProjectEntities,
} from '@/lib/commands/project'
import { projectCommandDescriptionOptionsSchema } from '@/lib/commands/project/commandDiscovery'
import { createEmptyProjectV2, validateProjectStructure } from '@/utils/project'
import { normalizeStoredProjectToV2, projectToStoredProjectV2, type LegacyProjectDocument } from '@/lib/projectV2/migration'
import { ensureDomainLanguage, setDomainLanguage } from '@/lib/i18n/domainI18n'
import { validateElectricalProjectWithCoverage } from '@/lib/validation/validateElectricalProject'

interface ProjectMetadata {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  revision: number
}

interface ProjectStorage {
  listProjects(): Promise<ProjectMetadata[]>
  getProject(id: string): Promise<{ project: LegacyProjectDocument; metadata: ProjectMetadata }>
  putProject(id: string, input: { project: LegacyProjectDocument; baseRevision: number | null }): Promise<ProjectMetadata>
}

const projectIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)
const pagination = {
  offset: z.number().int().min(0).max(1_000_000).default(0),
  limit: z.number().int().min(1).max(100).default(20),
}
const batchSchema = {
  projectId: projectIdSchema,
  expectedRevision: z.number().int().positive().describe('Storage revision returned by the latest project read.'),
  commands: z.array(z.strictObject({
    id: z.string().min(1).max(200),
    version: z.number().int().positive().optional(),
    as: z.string().min(1).max(100).optional(),
    input: z.record(z.string(), z.unknown()),
  })).min(1).max(100),
}

function toolResult(value: Record<string, unknown>, isError = false) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
    structuredContent: value,
    ...(isError ? { isError: true } : {}),
  }
}

function toolError(error: unknown) {
  if (error instanceof CommandError) {
    return toolResult({ error: { code: error.code, message: error.message, details: error.details } }, true)
  }
  if (error instanceof z.ZodError) {
    return toolResult({ error: { code: 'invalid_input', message: error.message } }, true)
  }
  if (error instanceof Error && 'statusCode' in error) {
    const code = error.statusCode === 409 ? 'stale_revision' : error.statusCode === 404 ? 'not_found' : 'storage_error'
    return toolResult({ error: { code, message: error.message } }, true)
  }
  console.error('Condui MCP tool failed:', error)
  return toolResult({ error: { code: 'internal_error', message: 'The operation failed. Check the Condui server log.' } }, true)
}

/** Every request gets its own protocol server; persisted storage is shared with the web editor. */
export function createConduiMcpServer(storage: ProjectStorage) {
  const server = new McpServer({ name: 'condui-community', version: '0.2.0' }, {
    instructions: 'Edit Condui electrical diagrams through the shared editor commands. Start with condui_list_projects or condui_create_project, then discover IDs, symbols and command schemas. Read the current revision before editing; preview batches before applying them. Use $created references for dependent commands. Run validation afterwards. Creation defaults are editable assumptions, not verified installation facts. Reload the browser project to see saved edits; unsaved browser edits are not accessible.',
  })

  function register<Shape extends z.ZodRawShape>(
    name: string,
    description: string,
    shape: Shape,
    readOnly: boolean,
    run: (input: z.output<z.ZodObject<Shape>>) => Promise<Record<string, unknown>> | Record<string, unknown>,
  ) {
    const inputSchema = z.strictObject(shape)
    server.registerTool<z.ZodRawShape, typeof inputSchema>(name, {
      description,
      inputSchema,
      annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, openWorldHint: false },
    }, async (input) => {
      try {
        return toolResult(await run(input as z.output<z.ZodObject<Shape>>))
      } catch (error) {
        return toolError(error)
      }
    })
  }

  async function load(projectId: string) {
    const stored = await storage.getProject(projectId)
    return { project: normalizeStoredProjectToV2(stored.project), metadata: stored.metadata }
  }

  register('condui_list_projects', 'List projects saved on this Condui server. Browser-only projects must first be moved to server storage.', {
    query: z.string().max(200).optional(), ...pagination,
  }, true, async ({ query, offset, limit }) => {
    const projects = (await storage.listProjects())
      .filter((project) => !query || project.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
      .sort((a, b) => a.id.localeCompare(b.id))
    return { projects: projects.slice(offset, offset + limit), total: projects.length, nextOffset: offset + limit < projects.length ? offset + limit : null }
  })

  register('condui_create_project', 'Create an editable Condui project with the normal blank-project defaults, a main panel and ground floor. Returns native IDs and storage revision. Set actual electrical ratings with properties.edit.', {
    name: z.string().trim().min(1).max(200),
    locale: z.enum(['nl-BE', 'en', 'fr-BE', 'de', 'pl', 'ro']).default('nl-BE'),
  }, false, async ({ name, locale }) => {
    await ensureDomainLanguage(locale)
    setDomainLanguage(locale)
    const project = createEmptyProjectV2(name)
    project.project.locale = locale
    const metadata = await storage.putProject(project.project.id, { project: projectToStoredProjectV2(project), baseRevision: null })
    return {
      project: metadata,
      revision: metadata.revision,
      panels: findProjectEntities(project, { kind: 'panel' }).entities,
      floors: findProjectEntities(project, { kind: 'floor' }).entities,
    }
  })

  register('condui_find_entities', 'Find real panel, circuit, endpoint, floor, placement and geometry IDs. Use returned revision for a subsequent edit.', {
    projectId: projectIdSchema, query: projectEntityQuerySchema.prefault({}),
  }, true, async ({ projectId, query }) => {
    const { project, metadata } = await load(projectId)
    return { revision: metadata.revision, ...findProjectEntities(project, query) }
  })

  register('condui_read_entities', 'Read bounded editable fields of up to 20 known entities, without project blobs. Inspect values before changing an existing diagram.', {
    projectId: projectIdSchema, refs: projectEntityReadSchema.shape.refs,
  }, true, async ({ projectId, refs }) => {
    const { project, metadata } = await load(projectId)
    return { revision: metadata.revision, ...readProjectEntities(project, { refs }) }
  })

  register('condui_get_graph', 'Inspect electrical connectivity, branch IDs and structural diagnostics. Optional panel/circuit filters and pagination keep large diagrams bounded.', {
    projectId: projectIdSchema, query: projectGraphQuerySchema.prefault({}),
  }, true, async ({ projectId, query }) => {
    const { project, metadata } = await load(projectId)
    return { revision: metadata.revision, ...inspectProjectGraph(project, query) }
  })

  register('condui_list_symbols', 'Find supported electrical symbols by English, Dutch or French name. Use exact symbol IDs in electrical.placeSymbol or plan.placeSymbol.', {
    query: z.string().max(200).optional(), scope: z.enum(['eendraad', 'situatieplan']).optional(), ...pagination,
  }, true, (query) => findProjectSymbols(query))

  register('condui_list_commands', 'List shared editor command IDs and versions. Discover a command schema before constructing inputs.', {}, true,
    () => ({ commands: listProjectCommands(projectCommands) }))

  register('condui_describe_command', 'Get a command input schema and examples. Use detail=full for the full schema, or section/variant to inspect a specific property family.', {
    commandId: z.string().min(1).max(200),
    options: projectCommandDescriptionOptionsSchema.default({ detail: 'summary' }),
  }, true, ({ commandId, options }) => describeProjectCommand(projectCommands, commandId, options))

  register('condui_get_workflow', 'Get a workflow and dependent example batch for drawing a house. Replace example panel-id with an ID from this project.', {
    workflow: z.enum(['house']).default('house'),
  }, true, ({ workflow }) => {
    const guide = describeProjectWorkflow(workflow)
    return {
      id: guide.id,
      discovery: [
        'Use condui_list_projects or condui_create_project, then condui_find_entities for real panel and floor IDs.',
        'Use condui_list_symbols and condui_describe_command before preparing a command batch.',
        'Give a command an as alias; later commands in that batch can use {$created:{from:ALIAS,kind:ENTITY_KIND}}. Use returned native IDs in later calls.',
      ],
      steps: guide.steps?.map(({ purpose, commands, note }) => ({ purpose, commands, note })),
      exampleBatch: {
        purpose: guide.exampleBatch?.purpose,
        placeholders: [{ value: 'panel-id', replaceWith: 'An existing panel ID from condui_find_entities or condui_create_project. The sample moves this panel to the new floor.' }],
        commands: guide.exampleBatch?.commands,
      },
      review: [
        'Read the graph and relevant entities. Set known electrical specifications through properties.edit; creation defaults are not measured installation facts.',
        'Run condui_preview_commands, then condui_apply_commands with the same commands and expectedRevision. Preview-created IDs are temporary.',
        'Run condui_validate_project and inspect both findings and coverage counts. Missing facts and unavailable checks remain unresolved.',
        'Reload the project in Condui to visually inspect the one-wire diagram, situation plan and panel layout. PDF and portable project export remain available in the editor.',
      ],
    }
  })

  async function runBatch(input: z.output<z.ZodObject<typeof batchSchema>>, preview: boolean) {
    const { project, metadata } = await load(input.projectId)
    if (metadata.revision !== input.expectedRevision) {
      throw new CommandError('stale_revision', 'The project changed. Read it again and prepare a new batch.')
    }
    const language = await ensureDomainLanguage(project.project.locale)
    const session = createHeadlessProjectSession(project, {
      registry: projectCommands, env: createDefaultCommandEnv(language), historyLimit: 0,
    })
    // The existing transaction executor resolves aliases and commits the entire batch or nothing.
    const outcome = session.execute(input.commands)
    const structure = validateProjectStructure(structuredClone(session.project))
    if (!structure.valid) throw new CommandError('check_failed', structure.errors.join('; '))
    if (preview || !outcome.changed) {
      return { revision: metadata.revision, preview, changed: outcome.changed, results: outcome.results }
    }
    const stored = projectToStoredProjectV2(session.project)
    stored.project.updatedAt = new Date().toISOString()
    // Compare again at the serialized write boundary, including writes made by the web editor.
    const saved = await storage.putProject(input.projectId, { project: stored, baseRevision: input.expectedRevision })
    return { revision: saved.revision, preview: false, changed: true, results: outcome.results }
  }

  register('condui_preview_commands', 'Execute up to 100 editor commands on a private draft without saving. Checks the whole dependent batch. Preview IDs are temporary; use $created aliases within the batch.', batchSchema, true,
    (input) => runBatch(input, true))

  register('condui_apply_commands', 'Atomically edit the stored diagram using shared editor commands. Requires the latest storage revision; conflicts and invalid batches save nothing. Supports {$created:{from:ALIAS,kind:ENTITY_KIND}} for entities created earlier in this batch. Reload the browser project after saving.', batchSchema, false,
    (input) => runBatch(input, false))

  register('condui_validate_project', 'Run the same electrical validation as the editor, plus structural checks. Returns paginated findings and check coverage; this is not a compliance certificate.', {
    projectId: projectIdSchema, ...pagination,
  }, true, async ({ projectId, offset, limit }) => {
    const { project, metadata } = await load(projectId)
    const structure = validateProjectStructure(structuredClone(project))
    const { issues, coverage } = await validateElectricalProjectWithCoverage(project, { language: project.project.locale })
    const { entries: _entries, ...coverageSummary } = coverage
    return { revision: metadata.revision, structure, issues: issues.slice(offset, offset + limit), total: issues.length,
      nextOffset: offset + limit < issues.length ? offset + limit : null, coverage: coverageSummary }
  })

  return server
}

function httpError(response: ServerResponse, status: number, message: string) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }))
}

/** Called only after the normal Community access/password guard has allowed this request. */
export async function handleMcpRequest(storage: ProjectStorage | null, request: IncomingMessage, response: ServerResponse) {
  if (request.headers.origin !== undefined) {
    let sameOrigin = false
    try {
      const origin = new URL(request.headers.origin)
      sameOrigin = ['http:', 'https:'].includes(origin.protocol) && origin.host === request.headers.host
    } catch { /* Reject malformed origins as well as cross-origin browser requests. */ }
    if (!sameOrigin) return httpError(response, 403, 'Cross-origin MCP requests are not allowed.')
  }
  if (!storage) return httpError(response, 503, 'MCP requires server storage. Set CONDUI_DATA_DIR to an existing directory or mount /data.')
  // This stateless endpoint does not keep an SSE notification channel or resumable sessions.
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    return httpError(response, 405, 'Use POST for the Streamable HTTP MCP endpoint.')
  }
  const server = createConduiMcpServer(storage)
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: 4 * 1024 * 1024,
  })
  response.setHeader('Cache-Control', 'no-store')
  response.once('close', () => { void server.close().catch((error) => console.error('MCP close failed:', error)) })
  try {
    await server.connect(transport)
    await transport.handleRequest(request, response)
  } catch (error) {
    console.error('Condui MCP request failed:', error)
    if (!response.headersSent) httpError(response, 500, 'MCP request failed.')
    await server.close()
  }
}
