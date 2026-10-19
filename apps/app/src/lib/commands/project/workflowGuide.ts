import { CommandError, type CommandInvocation } from './types'

const created = (from: string, kind: string) => ({ $created: { from, kind } })

/** Read-only teaching material; examples run through the normal registered commands. */
export function describeProjectWorkflow(workflow?: string) {
  if (workflow !== undefined && workflow !== 'house')
    throw new CommandError('invalid_input', `Unknown workflow "${workflow}". Available workflows: house.`)

  const discovery = [
    'Start with --guide house for grouped steps and a dependent example batch. These guides do not edit a project.',
    'Use --describe with comma-separated command IDs for concise summaries and examples. Narrow large schemas with --section and optional --variant; use --fields for compact writable names/types across comma-separated variants, and --full-schema only when needed.',
    'Get existing IDs from --new results or bounded --find/--graph reads. Example IDs such as panel-id are placeholders, not IDs to invent.',
    'Give batch invocations an as alias; later fields can use {$created:{from:ALIAS,kind:ENTITY_KIND}}. Aliases are local to that one atomic batch. Use returned native IDs in later calls.',
  ]
  const workflows = [{ id: 'house', purpose: 'Build floors, a schematic, plan occurrences and panel arrangement; then validate and inspect drawings.' }]

  if (workflow === undefined)
    return { id: 'overview', workflows, discovery, steps: undefined, exampleBatch: undefined, review: undefined }

  const commands: CommandInvocation[] = [
    { id: 'floor.create', as: 'floor', input: { name: 'Upper floor', scale: { pxPerMeter: 100 } } },
    {
      id: 'plan.createBuildingGeometry', as: 'wall',
      input: { kind: 'wall', floorId: created('floor', 'floor'), points: [{ x: 0, y: 0 }, { x: 800, y: 0 }], thickness: 20 },
    },
    {
      id: 'plan.createBuildingGeometry',
      input: { kind: 'door', floorId: created('floor', 'floor'), wallId: created('wall', 'wall'), position: 0.5, width: 90, swing: 'left', direction: 'in' },
    },
    { id: 'circuit.createEmpty', as: 'lighting', input: { panelId: 'panel-id', kind: 'lighting' } },
    {
      id: 'electrical.placeSymbol', as: 'switch',
      input: {
        symbolId: 'switch', destination: { kind: 'circuit', circuitId: created('lighting', 'circuit') },
        planPlacement: { floorId: created('floor', 'floor'), pos: { x: 200, y: 150 } },
      },
    },
    {
      id: 'electrical.placeSymbol', as: 'light',
      input: {
        symbolId: 'light_point', destination: { kind: 'endpoint', endpointId: created('switch', 'endpoint') },
        planPlacement: { floorId: created('floor', 'floor'), pos: { x: 400, y: 200 } },
      },
    },
    {
      id: 'properties.edit',
      input: { edits: [{ kind: 'endpoint', ids: [created('switch', 'endpoint')], set: { controlledEndpointIds: [created('light', 'endpoint')] } }] },
    },
    {
      id: 'plan.drawWire',
      input: { floorId: created('floor', 'floor'), sourcePlacementId: created('switch', 'placement'), targetPlacementId: created('light', 'placement') },
    },
    {
      id: 'plan.placeExisting',
      input: { target: { kind: 'panel', id: 'panel-id' }, floorId: created('floor', 'floor'), layer: 'electrical', pos: { x: 100, y: 100 } },
    },
    {
      id: 'panel.editLayout',
      input: { autoArrange: { panelIds: ['panel-id'], feedSideDirection: 'left' }, supplyVisibility: [{ panelId: 'panel-id', visible: true }] },
    },
  ]

  return {
    id: 'house', workflows, discovery,
    steps: [
      {
        purpose: 'Inspect or create the project; keep its real board and floor IDs.',
        commands: [],
        reads: ['--new "House" --out house.zip', '--project house.zip --find panels.json', '--project house.zip --graph graph.json'],
        queries: { 'panels.json': { kind: 'panel', limit: 20 }, 'graph.json': { limit: 40 } },
      },
      {
        purpose: 'Set floor scale, draw walls, attach openings and label rooms.',
        commands: ['floor.create', 'plan.calibrateScale', 'plan.createBuildingGeometry', 'annotation.createNote'],
        note: 'At scale {pxPerMeter:100}, 800 canvas pixels is 8 m. Wall points, thickness and opening width use canvas pixels; opening position is a 0–1 fraction along its wall.',
      },
      {
        purpose: 'Create circuits and branches; put a light after its controlling switch.',
        commands: ['circuit.createEmpty', 'electrical.placeSymbol', 'properties.edit'],
        note: 'A circuit destination starts a new branch. An endpoint destination joins the existing branch after that endpoint. Explicit controlledEndpointIds declares switch control separately. Select symbol IDs with --symbols. Use planPlacement {floorId,pos:{x,y}} for exact placement; sitplan.viewportCenter is an automatic hint that may move to avoid collisions. Choose one mode.',
      },
      {
        purpose: 'Place existing boards/devices on floors and connect plan routes.',
        commands: ['plan.placeExisting', 'plan.movePlacements', 'plan.drawWire'],
        note: 'Reuse target {kind:panel,id:PANEL_ID} for an existing board. Its physical occurrence moves to the requested floor; this does not create a board or reconnect its feeder. Place a new board electrically with panel_distribution on its intended feeder, then use its returned panel ID.',
      },
      {
        purpose: 'Arrange physical modules and show the intended modules.',
        commands: ['panel.editLayout', 'properties.edit'],
        note: 'panel.editLayout autoArrange lays out modules, panels assigns slots/grid dimensions, and supplyVisibility shows the supply area. properties.edit actions variant panelModuleVisibility shows/hides an individual typed module. These physical edits do not reconnect circuits.',
      },
    ],
    exampleBatch: {
      purpose: 'Small teaching sample: one calibrated floor, wall/door, switched light, plan route and existing board placement. Extend it to the actual house; it is not an electrical design or a complete house.',
      placeholders: [{ value: 'panel-id', replaceWith: 'The existing board ID from --new or a panel query. This sample relocates that board to the new floor.' }],
      commands,
    },
    review: [
      'Read --graph with {panelId:PANEL_ID,includePlacements:true,limit:40} for compact connections, native IDs and floor occurrences; use --describe-graph for query fields and snapshot pagination.',
      'Read --read with a JSON file containing {"refs":[{"kind":"endpoint","id":"SWITCH_ID"}]} for detailed properties. Follow nextOffset on paged reads; do not request the entire project to obtain a few IDs.',
      'Set installation.address.country to BE for Belgian validation (Belgian names are normalized). Set only known ratings/cables/protection facts with properties.edit. Omitted fields preserve values, including defaults; null clears supported fields. Use --describe properties.edit --section edits --variant protection,circuit,trunkDevice --fields to list writable types and supported clears. Creation defaults are not measured installation facts.',
      'Run --validate and --validation-coverage with a JSON query file containing {}. Separate actual errors from checks skipped or unavailable because facts are missing; a passing run does not establish unknown facts.',
      'When asked to explain a finding, read --validation-help with {ruleId:RULE_ID,language:LOCALE} for source article text and a public link. Use everyday words and explain the actual finding, its importance and the next useful check. Unknown specifications are not evidence of absent equipment; keep missing facts explicit.',
      'Use --describe-scene for the selector schema. Inspect --scene-geometry with a JSON file containing {"kind":"plan","floorId":"FLOOR_ID"}, {"kind":"panel","panelId":"PANEL_ID"} or {"kind":"one-wire","panelId":"PANEL_ID"}; then render --pdf drawings.pdf --preview pages. Visually check door swings, labels, module visibility and branch connections; bounding boxes alone do not prove clearance.',
      'Save to a new ZIP, reopen it and validate/inspect again. Assistant/MCP connections remain paused; these local reads and commands do not enable them.',
    ],
  }
}
