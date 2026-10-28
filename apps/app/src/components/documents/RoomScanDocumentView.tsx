import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Box, CameraOff, Download, RotateCcw, ZoomIn, ZoomOut, Images, Check, ChevronRight, ClipboardCheck, Search } from 'lucide-react'
import CanvasFloatingControlRail from '@/components/canvas/CanvasFloatingControlRail'
import { FloatingControl } from '@/components/canvas/FloatingControls'
import { ScanPlacementSymbol } from './ScanPlacementSymbol'
import { ScanPlacementCircuitPicker } from './ScanPlacementCircuitPicker'
import { EendraadIcon, SitplanIcon } from '@/components/viewport/CanvasIcons'
import { focusSelectionOnCanvas } from '@/lib/ui/focusSelectionOnCanvas'
import { VisibilityIcon } from '@/components/icons/UiIcons'
import type { ProjectDocument } from '@/lib/documents/projectDocuments'
import {
  roomScanModelDocumentSchema, roomScanPlacementsDocumentSchema,
  type RoomScanModelDocument, type RoomScanPlacementsDocument,
} from '@/lib/documents/roomScanDocuments'
import { readProjectDocumentBytes } from './documentBytes'
import { getSymbolById } from '@/lib/symbols'
import { getLocalizedSymbolName } from '@/lib/symbolNames'
import { useProjectStore } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import { getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { collectCircuits, findPanelById, walkPanels } from '@/lib/panel/panelTree'
import { revealCanvas } from '@/lib/ui/revealCanvas'
import { revealProjectDocument } from './revealProjectDocument'
import { runProjectCommand } from '@/stores/liveProjectCommandSession'

const iconActionClass = 'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
type ModelLayer = 'wall' | 'openings' | 'floor' | 'object'
type Point3 = { x: number; y: number; z: number }
type ModelFace = { id: string; points: Point3[]; kind: string }

function modelFaces(model: RoomScanModelDocument): ModelFace[] {
  const faces: ModelFace[] = []
  for (const part of model.parts.slice(0, 1_000)) {
    const { x, y, z } = part.dimensions
    const dimensions = [Math.max(x, 0.03), Math.max(y, 0.03), Math.max(z, part.kind === 'wall' ? 0.06 : 0.03)]
    const m = part.transform
    const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((index) => {
      const a = dimensions[0]! * ((index & 1) ? 0.5 : -0.5)
      const b = dimensions[1]! * ((index & 2) ? 0.5 : -0.5)
      const c = dimensions[2]! * ((index & 4) ? 0.5 : -0.5)
      return { x: m[0]! * a + m[4]! * b + m[8]! * c + m[12]!, y: m[1]! * a + m[5]! * b + m[9]! * c + m[13]!, z: m[2]! * a + m[6]! * b + m[10]! * c + m[14]! }
    })
    for (const [face, indices] of [[0, [0, 1, 3, 2]], [1, [4, 6, 7, 5]], [2, [0, 4, 5, 1]], [3, [2, 3, 7, 6]], [4, [0, 2, 6, 4]], [5, [1, 5, 7, 3]]] as const) {
      faces.push({ id: `${part.id}:${face}`, points: indices.map((index) => corners[index]!), kind: part.kind })
    }
  }
  return faces
}

function RoomModel({ model }: { model: RoomScanModelDocument }) {
  const { t } = useTranslation()
  const [camera, setCamera] = useState({ yaw: 0.65, pitch: 0.48, zoom: 1 })
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [visible, setVisible] = useState<Record<ModelLayer, boolean>>({ wall: true, openings: true, floor: true, object: true })
  const points = useRef(new Map<number, { x: number; y: number }>())
  const faces = useMemo(() => modelFaces(model), [model])
  const projected = useMemo(() => {
    const all = faces.flatMap((face) => face.points)
    if (!all.length) return []
    const min = { x: Infinity, y: Infinity, z: Infinity }, max = { x: -Infinity, y: -Infinity, z: -Infinity }
    for (const point of all) for (const axis of ['x', 'y', 'z'] as const) { min[axis] = Math.min(min[axis], point[axis]); max[axis] = Math.max(max[axis], point[axis]) }
    const center = { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 }
    const radius = Math.max(1, Math.hypot(max.x - min.x, max.y - min.y, max.z - min.z))
    const scale = 500 / radius * camera.zoom
    const cy = Math.cos(camera.yaw), sy = Math.sin(camera.yaw), cp = Math.cos(camera.pitch), sp = Math.sin(camera.pitch)
    return faces.map((face) => {
      const points = face.points.map((point) => {
        const dx = point.x - center.x, dy = point.y - center.y, dz = point.z - center.z
        const x = dx * cy - dz * sy, z = dx * sy + dz * cy
        return { x: 400 + x * scale, y: 260 - (dy * cp - z * sp) * scale, depth: dy * sp + z * cp }
      })
      return { ...face, points: points.map((point) => `${point.x},${point.y}`).join(' '), depth: points.reduce((sum, point) => sum + point.depth, 0) / 4 }
    }).sort((a, b) => a.depth - b.depth)
  }, [faces, camera])
  const changeZoom = (factor: number) => setCamera((current) => ({ ...current, zoom: Math.max(0.3, Math.min(4, current.zoom * factor)) }))
  return <div className="relative flex h-full min-h-64 flex-col bg-slate-50 dark:bg-slate-950">
    <CanvasFloatingControlRail side="right" offsetPx={16} zIndex={20} menuOpen={filtersOpen}
      dataCanvasOverlayAnchor="right" dataCanvasOverlayPosition="center-right">
      <FloatingControl icon={<VisibilityIcon className="h-6 w-6" />} label={t('sitplanVisibility.title')}
        variant="menu" open={filtersOpen} onOpenChange={setFiltersOpen} mobileMenuFitCanvas
        triggerTestId="scan-model-filters">
        <div className="w-56 space-y-1 rounded-lg border border-gray-200 bg-white p-2 shadow-lg dark:border-gray-600 dark:bg-gray-800">
          {(['object', 'wall', 'openings', 'floor'] as const).map((layer) => <label key={layer}
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700">
            <input type="checkbox" checked={visible[layer]} onChange={(event) => setVisible((current) => ({ ...current, [layer]: event.target.checked }))}
              className="h-4 w-4 accent-sky-600" />
            {t(`nativeRoomScan.modelLayers.${layer}`)}
          </label>)}
        </div>
      </FloatingControl>
      <FloatingControl icon={<ZoomIn size={22} />} label={t('nativeRoomScan.zoomIn')} variant="menu" onClick={() => changeZoom(1.2)} />
      <FloatingControl icon={<ZoomOut size={22} />} label={t('nativeRoomScan.zoomOut')} variant="menu" onClick={() => changeZoom(1 / 1.2)} />
      <FloatingControl icon={<RotateCcw size={22} />} label={t('nativeRoomScan.resetView')} variant="menu"
        onClick={() => setCamera({ yaw: 0.65, pitch: 0.48, zoom: 1 })} />
    </CanvasFloatingControlRail>
    <svg role="img" aria-label={t('nativeRoomScan.modelDocument')} viewBox="0 0 800 520" className="min-h-0 w-full flex-1 cursor-grab active:cursor-grabbing" style={{ touchAction: 'none' }}
      onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); points.current.set(event.pointerId, { x: event.clientX, y: event.clientY }) }}
      onPointerMove={(event) => {
        const old = points.current.get(event.pointerId)
        if (!old) return
        const other = [...points.current.entries()].find(([id]) => id !== event.pointerId)?.[1]
        if (other) {
          const before = Math.hypot(old.x - other.x, old.y - other.y)
          const after = Math.hypot(event.clientX - other.x, event.clientY - other.y)
          if (before > 5) changeZoom(after / before)
        } else {
          const bounds = event.currentTarget.getBoundingClientRect()
          const radiansPerPixel = Math.PI / Math.max(320, Math.min(bounds.width, bounds.height))
          const dx = event.clientX - old.x, dy = event.clientY - old.y
          // Turn the visible model toward the finger. Projection flips world Y,
          // so horizontal and vertical drags need opposite angle signs.
          setCamera((current) => ({ ...current,
            yaw: current.yaw - dx * radiansPerPixel,
            pitch: Math.max(-1.3, Math.min(1.3, current.pitch + dy * radiansPerPixel)),
          }))
        }
        points.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      }}
      onPointerUp={(event) => points.current.delete(event.pointerId)} onPointerCancel={(event) => points.current.delete(event.pointerId)}
      onLostPointerCapture={(event) => points.current.delete(event.pointerId)}
    >
      {projected.filter((face) => visible[face.kind === 'wall' || face.kind === 'floor' || face.kind === 'object' ? face.kind : 'openings']).map((face) => <polygon key={face.id} points={face.points}
        className={face.kind === 'window' || face.kind === 'door' || face.kind === 'opening' ? 'fill-sky-300 stroke-sky-700 dark:fill-sky-700 dark:stroke-sky-300' : face.kind === 'object' ? 'fill-slate-400 stroke-slate-600 dark:fill-slate-600 dark:stroke-slate-300' : 'fill-slate-200 stroke-slate-500 dark:fill-slate-800 dark:stroke-slate-400'}
        fillOpacity={face.kind === 'wall' ? 0.4 : 0.7} strokeWidth={0.8} />)}
    </svg>
  </div>
}

function PlacementEvidence({ data, document, canEditProject }: { data: RoomScanPlacementsDocument; document: ProjectDocument; canEditProject: boolean }) {
  const { t, i18n } = useTranslation()
  const project = useProjectStore((state) => state.currentProject)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const panels = project ? getProjectElectricalPanels(project) : []
  const circuits = [...walkPanels(panels)].flatMap(collectCircuits)
  const entries = data.entries.map((entry, index) => {
    const circuit = circuits.find((candidate) => candidate.endpoints.some((endpoint) => endpoint.id === entry.target.id))
    return { entry, index, circuit, endpoint: circuit?.endpoints.find((endpoint) => endpoint.id === entry.target.id) }
  })
  const rooms = new Map<string, typeof entries>()
  for (const item of entries) {
    const room = item.entry.roomName || item.circuit?.scanReview?.roomName || document.roomScan?.roomName || t('nativeRoomScan.roomNameDefault')
    rooms.set(room, [...(rooms.get(room) ?? []), item])
  }
  const selectedIds = entries.filter((item) => item.endpoint && selected.has(item.entry.id)).map((item) => item.endpoint!.id)
  const toggle = (ids: string[], checked: boolean) => setSelected((current) => {
    const next = new Set(current)
    for (const id of ids) { if (checked) next.add(id); else next.delete(id) }
    return next
  })
  const pending = [...walkPanels(panels)].flatMap((panel) => collectCircuits(panel)).filter((circuit) => circuit.scanReview?.scanId === document.roomScan?.scanId)
  return <div data-app-scroll="true" className="h-full space-y-4 overflow-y-auto p-4">
    {selectedIds.length > 0 && <div className="sticky top-0 z-10 flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 p-2 shadow-sm dark:border-sky-800 dark:bg-sky-950">
      <span className="shrink-0 px-1 text-sm font-medium">{selectedIds.length}</span>
      <div className="min-w-0 flex-1"><ScanPlacementCircuitPicker endpointIds={selectedIds} scanId={document.roomScan?.scanId}
        disabled={!canEditProject} onAssigned={() => setSelected(new Set())} /></div>
      <button type="button" className={iconActionClass} aria-label={t('nativeRoomScan.clearSelection')} title={t('nativeRoomScan.clearSelection')}
        onClick={() => setSelected(new Set())}>×</button>
    </div>}
    {pending.length > 0 && <details className="group rounded-lg bg-amber-50 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 [&::-webkit-details-marker]:hidden">
        <ClipboardCheck size={18} /><span>{t('nativeRoomScan.toReview')} ({pending.length})</span>
        <ChevronRight size={16} className="ml-auto transition-transform group-open:rotate-90" />
      </summary>
      <div className="space-y-1 border-t border-amber-200 px-3 pb-2 dark:border-amber-900">
      <p className="py-2 text-xs">{t('nativeRoomScan.reviewHint')}</p>
      {pending.map((circuit) => <div key={circuit.id} className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 flex-1 truncate">{circuit.code} · {circuit.scanReview?.roomName}</span>
        <button type="button" className={iconActionClass} title={t('nativeRoomScan.reviewCircuit')} aria-label={t('nativeRoomScan.reviewCircuit')} onClick={() => {
          useUIStore.getState().setSelection({ type: 'circuit', ids: [circuit.id] }); revealCanvas('eendraad')
        }}><ChevronRight size={20} /></button>
        <button type="button" className={iconActionClass} disabled={!canEditProject} title={t('nativeRoomScan.markReviewed')} aria-label={t('nativeRoomScan.markReviewed')} onClick={() => runProjectCommand('properties.edit', {
          edits: [{ kind: 'circuit', ids: [circuit.id], set: { scanReview: null, hideWireLabel: false, notes: circuit.notes?.split(' · ').slice(0, -1).join(' · ') ?? '' } }],
        }, { label: 'nativeRoomScan.markReviewed' })}><Check size={20} /></button>
      </div>)}
      </div>
    </details>}
    {[...rooms].map(([room, items]) => <section key={room} className="space-y-3">
      <div className="flex min-h-11 items-center gap-2 border-b border-gray-200 dark:border-gray-700">
        <label className="flex min-h-11 min-w-0 flex-1 items-center gap-3 font-medium">
          <input type="checkbox" className="h-4 w-4 accent-sky-600" disabled={!canEditProject || !items.some((item) => item.endpoint)}
            checked={items.some((item) => item.endpoint) && items.filter((item) => item.endpoint).every((item) => selected.has(item.entry.id))}
            onChange={(event) => toggle(items.filter((item) => item.endpoint).map((item) => item.entry.id), event.target.checked)} />
          <span className="truncate">{room}</span>
        </label>
        <span className="text-xs text-gray-500">{items.length}</span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
      {items.map(({ entry, index, circuit, endpoint }) => {
        const symbol = getSymbolById(entry.symbolId)
        const name = symbol ? getLocalizedSymbolName(symbol, i18n.language) : entry.symbolId
        const panel = entry.target.type === 'panel' ? findPanelById(panels, entry.target.id) : undefined
        const exists = !!endpoint || !!panel
        const show = (plan: boolean) => {
          const ui = useUIStore.getState()
          if (plan) {
            const floorId = endpoint?.placements.find((placement) => placement.id === entry.placementId)?.floorId ?? document.roomScan?.floorId
            if (floorId && project?.building.floors.some((floor) => floor.id === floorId)) ui.setActiveFloor(floorId)
          }
          ui.setSelection({ type: plan ? 'placement' : entry.target.type, ids: [plan ? entry.placementId : entry.target.id] })
          const canvas = plan ? 'plan' : 'eendraad'
          if (ui.viewportLayout.panels.some((panel) => panel.canvas === 'documents') && ui.viewportLayout.panels.length > 1) ui.setPanelCanvas(0, canvas)
          else revealCanvas(canvas)
          focusSelectionOnCanvas(useUIStore.getState().selection, { preferredCanvas: canvas })
        }
        return <figure key={entry.id} className={`relative overflow-hidden rounded-lg border bg-white dark:bg-gray-900 ${selected.has(entry.id) ? 'border-sky-500 ring-1 ring-sky-500' : 'border-gray-200 dark:border-gray-700'}`}>
          {endpoint && <input type="checkbox" aria-label={`${t('nativeRoomScan.selectPlacement')} ${endpoint.label || name} ${index + 1}`}
            className="absolute left-2 top-2 z-10 h-5 w-5 accent-sky-600" disabled={!canEditProject}
            checked={selected.has(entry.id)} onChange={(event) => toggle([entry.id], event.target.checked)} />}
          {entry.photoDataUrl ? <img src={entry.photoDataUrl} alt={`${name} ${index + 1}`} loading="lazy" className="aspect-square w-full object-cover" /> : <div className="flex aspect-square items-center justify-center bg-gray-100 dark:bg-gray-800"><CameraOff className="text-gray-400" aria-label={t('nativeRoomScan.noPhoto')} /></div>}
          <figcaption className="space-y-2 p-3">
            <div className="flex items-center gap-2"><ScanPlacementSymbol symbolId={entry.symbolId} quantity={entry.quantity} /><strong className="min-w-0 flex-1 text-sm font-medium">{panel?.name || endpoint?.label || `${name} ${index + 1}`}</strong>{entry.quantity > 1 && <span>×{entry.quantity}</span>}</div>
            <p className="text-xs text-gray-500 dark:text-gray-400">{t('nativeRoomScan.capturedHeight')}: {entry.heightCm} cm</p>
            {!exists && <p className="text-xs text-amber-700 dark:text-amber-300">{t('nativeRoomScan.elementRemoved')}</p>}
            {endpoint && <ScanPlacementCircuitPicker endpointIds={[endpoint.id]} circuitId={circuit?.id}
              scanId={document.roomScan?.scanId} disabled={!canEditProject} />}
            <div className="flex justify-end gap-1">
              {([true, false] as const).map((plan) => <button key={String(plan)} type="button" className={`${iconActionClass} gap-1 w-auto px-2`}
                disabled={!exists} aria-label={t(plan ? 'nativeRoomScan.showOnPlan' : 'nativeRoomScan.showOnOneWire')}
                title={t(plan ? 'nativeRoomScan.showOnPlan' : 'nativeRoomScan.showOnOneWire')} onClick={() => show(plan)}>
                <Search size={15} />{plan ? <SitplanIcon className="h-5 w-5" /> : <EendraadIcon className="h-5 w-5" />}
              </button>)}
            </div>
          </figcaption>
        </figure>
      })}
      </div>
    </section>)}
  </div>
}

/** Compact actions share the Documents header rather than stacking another toolbar. */
export function RoomScanDocumentActions({ document }: { document: ProjectDocument }) {
  const { t } = useTranslation()
  const relatedExists = useProjectStore((state) => !!state.currentProject?.assets.some((asset) => asset.id === document.roomScan?.relatedDocumentId))
  return <div className="ml-auto flex shrink-0 items-center gap-1">
    <div className="flex rounded-md border border-gray-200 p-0.5 dark:border-gray-700">
      {(['roomScanModel', 'roomScanPlacements'] as const).map((kind) => {
        const active = document.kind === kind
        if (!active && !relatedExists) return null
        const title = t(kind === 'roomScanModel' ? 'nativeRoomScan.modelDocument' : 'nativeRoomScan.placementsDocument')
        return <button key={kind} type="button" aria-label={title} title={title} aria-pressed={active}
          className={`${iconActionClass} ${active ? 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300' : ''}`}
          onClick={() => { if (!active && document.roomScan?.relatedDocumentId) revealProjectDocument(document.roomScan.relatedDocumentId) }}>
          {kind === 'roomScanModel' ? <Box size={21} /> : <Images size={21} />}
        </button>
      })}
    </div>
    <a href={document.url} download={document.name + '.json'} className={iconActionClass}
      title={t('nativeRoomScan.downloadScan')} aria-label={t('nativeRoomScan.downloadScan')}><Download size={20} /></a>
  </div>
}

export function RoomScanDocumentView({ document, canEditProject = true }: { document: ProjectDocument; canEditProject?: boolean }) {
  const { t } = useTranslation()
  const [payload, setPayload] = useState<RoomScanModelDocument | RoomScanPlacementsDocument | null>(null)
  const [failed, setFailed] = useState(false)
  const { id: documentId, url: documentUrl, kind: documentKind } = document
  const [previousSource, setPreviousSource] = useState({ documentId, documentUrl, documentKind })
  if (previousSource.documentId !== documentId || previousSource.documentUrl !== documentUrl || previousSource.documentKind !== documentKind) {
    setPreviousSource({ documentId, documentUrl, documentKind })
    setPayload(null)
    setFailed(false)
  }
  useEffect(() => {
    let active = true
    void readProjectDocumentBytes({ id: documentId, url: documentUrl }).then((bytes) => {
      const json: unknown = JSON.parse(new TextDecoder().decode(bytes))
      const parsed = documentKind === 'roomScanModel' ? roomScanModelDocumentSchema.parse(json) : roomScanPlacementsDocumentSchema.parse(json)
      if (active) setPayload(parsed)
    }).catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [documentId, documentUrl, documentKind])
  return <div className="flex h-full flex-col text-gray-800 dark:text-gray-100">
    <div className="min-h-0 flex-1">
      {failed ? <p role="alert" className="p-4 text-sm text-rose-700 dark:text-rose-300">{t('nativeRoomScan.documentFailed')}</p> : !payload ? <p className="p-4 text-sm">{t('common.loading')}</p> : 'parts' in payload ? <RoomModel model={payload} /> : <PlacementEvidence data={payload} document={document} canEditProject={canEditProject} />}
    </div>
  </div>
}
