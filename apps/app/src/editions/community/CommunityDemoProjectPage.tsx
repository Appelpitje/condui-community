import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { selectProjectBuildingFloors } from '@/lib/projectV2/buildingFloors'
import { logger } from '@/lib/logger'
import { startDemoProjectExpiry } from '@/lib/demoProject'
import { preloadProjectRasterImages } from '@/lib/preloadProjectRasterImages'
import { waitForOpenShellSettle } from '@/lib/waitForOpenShellSettle'
import { useProjectStore } from '@/stores/projectStore'
import { DEFAULT_LAYOUTS, useUIStore } from '@/stores/uiStore'
import { useValidationStore } from '@/stores/validationStore'
import { generateId } from '@/utils/project'
import CommunityLayout from './CommunityLayout'
import { importCommunityProject } from './communityProjectPackage'

const EXAMPLE_PROJECT_ZIP_PATH = '/examples/starter-project.zip'

type DemoLoadPhase = 'opening' | 'ready' | 'failed'

function DemoOpeningOverlay({ phase }: { phase: DemoLoadPhase }) {
  const { t } = useTranslation()
  const failed = phase === 'failed'

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[2px] dark:bg-black/55"
      role="dialog"
      aria-modal="true"
      aria-busy={!failed}
    >
      <div className="w-full max-w-md rounded-md border border-slate-200/80 bg-white p-8 shadow-xl dark:border-slate-600 dark:bg-slate-800">
        {!failed ? (
          <div className="mb-5 flex justify-center">
            <div
              className="h-11 w-11 animate-spin rounded-full border-2 border-sky-200 border-t-sky-600 dark:border-slate-600 dark:border-t-sky-400"
              aria-hidden
            />
          </div>
        ) : null}
        <h1 className="text-center text-lg font-semibold text-slate-800 dark:text-slate-100">
          {failed
            ? t('project.demoFailedTitle', { defaultValue: 'Demo project could not open' })
            : t('project.demoOpeningTitle', { defaultValue: 'Opening demo project' })}
        </h1>
        <p className="mt-2 text-center text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          {failed
            ? t('project.demoFailedBody', {
                defaultValue: 'The bundled example project could not be loaded. Please try again later.',
              })
            : t('project.demoOpeningBody', {
                defaultValue: 'Loading the example directly in demo mode.',
              })}
        </p>
      </div>
    </div>
  )
}

export default function CommunityDemoProjectPage() {
  const [loadPhase, setLoadPhase] = useState<DemoLoadPhase>('opening')

  useEffect(() => startDemoProjectExpiry(), [])

  useEffect(() => {
    const projectStore = useProjectStore.getState()
    const ui = useUIStore.getState()
    projectStore.setCurrentProjectStorageMode('local')
    projectStore.setPlanFloorOverlayVisibleByBaseFloorId({})
    ui.setActiveFloor(null)
    ui.setActivePanelId(null)
    ui.setPanelCanvasMode({ kind: 'all' })
    ui.setSitplanPanelFilterId(null)
    ui.clearSelection()
    ui.clearHover()
    ui.setViewportLayout(DEFAULT_LAYOUTS.sideBySide())

    let cancelled = false
    let firstFitFrame: number | null = null
    let secondFitFrame: number | null = null
    const decodeAbort = new AbortController()

    void (async () => {
      try {
        const response = await fetch(EXAMPLE_PROJECT_ZIP_PATH)
        if (!response.ok) throw new Error(`Example project not found at ${EXAMPLE_PROJECT_ZIP_PATH}`)

        const project = await importCommunityProject(await response.blob())
        const demoProjectId = `demo-${generateId()}`
        project.project.id = demoProjectId
        project.project.name = 'Demo'
        const now = new Date().toISOString()
        project.project.createdAt = now
        project.project.updatedAt = now

        if (cancelled) return
        projectStore.setProject(project)
        useValidationStore.getState().markProjectOpened()
        ui.setActiveFloor(selectProjectBuildingFloors(project)[0]?.id ?? null)
        await preloadProjectRasterImages(project, { concurrency: 2, signal: decodeAbort.signal })
        if (cancelled || useProjectStore.getState().currentProject?.project.id !== demoProjectId) return
        await waitForOpenShellSettle()
        if (cancelled || useProjectStore.getState().currentProject?.project.id !== demoProjectId) return

        setLoadPhase('ready')
        firstFitFrame = requestAnimationFrame(() => {
          secondFitFrame = requestAnimationFrame(() => {
            if (!cancelled) ui.requestFitToView(['plan', 'panel', 'eendraad'])
          })
        })
      } catch (error) {
        logger.error('Failed to open community demo project:', error)
        if (!cancelled) setLoadPhase('failed')
      }
    })()

    return () => {
      cancelled = true
      decodeAbort.abort()
      if (firstFitFrame != null) cancelAnimationFrame(firstFitFrame)
      if (secondFitFrame != null) cancelAnimationFrame(secondFitFrame)
    }
  }, [])

  return (
    <>
      {loadPhase === 'ready' ? (
        <CommunityLayout demoMode />
      ) : (
        <div className="h-dvh w-full bg-slate-100 dark:bg-slate-900" aria-hidden />
      )}
      {loadPhase !== 'ready' ? <DemoOpeningOverlay phase={loadPhase} /> : null}
    </>
  )
}
