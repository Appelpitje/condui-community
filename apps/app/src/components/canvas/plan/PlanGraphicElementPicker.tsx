import { useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useCanvasWindow } from '@/components/viewport/ViewportContext'
import { PLAN_GRAPHIC_ELEMENT_ASSETS } from '@/lib/plan/graphicElements'
import type { Point } from '@/types/ui'

interface PlanGraphicElementPickerProps {
  clientAnchor: Point
  label: string
  onAddNote: () => void
  onAddGraphicElement: (assetId: string) => void
  onClose: () => void
}

/** Owns the graphic palette's pointer shielding and keyboard focus lifecycle. */
export function PlanGraphicElementPicker({
  clientAnchor,
  label,
  onAddNote,
  onAddGraphicElement,
  onClose,
}: PlanGraphicElementPickerProps) {
  const window = useCanvasWindow()
  const { t } = useTranslation()
  const firstOptionRef = useRef<HTMLButtonElement>(null)

  useLayoutEffect(() => {
    const previousFocus = firstOptionRef.current?.ownerDocument.activeElement
    firstOptionRef.current?.focus()
    return () => {
      if (previousFocus?.isConnected && 'focus' in previousFocus && typeof previousFocus.focus === 'function') {
        previousFocus.focus()
      }
    }
  }, [])

  return (
    <div
      role="presentation"
      data-app-modal-backdrop="true"
      className="fixed inset-0 z-[100]"
      onClick={() => onClose()}
      onContextMenu={(event) => {
        event.preventDefault()
        onClose()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Tab') {
          // Let buttons use native Tab navigation without the editor's dock shortcut.
          event.stopPropagation()
          return
        }
        if (event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }}
    >
      <div
        role="presentation"
        className="absolute w-48 overflow-hidden rounded-md border border-gray-200 bg-white py-1 shadow-xl dark:border-gray-700 dark:bg-gray-800"
        style={{
          left: Math.max(8, Math.min(clientAnchor.x, window.innerWidth - 208)),
          top: Math.max(8, Math.min(clientAnchor.y, window.innerHeight - 300)),
          maxHeight: 'min(18rem, calc(100vh - 1rem))',
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div role="dialog" aria-label={label}>
          <button
            ref={firstOptionRef}
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
            onClick={() => onAddNote()}
          >
            <span aria-hidden="true" className="w-5 shrink-0 text-center text-[0.6rem] font-bold leading-none">
              Aa
            </span>
            <span>{t('floorPlanTools.placeNote')}</span>
          </button>
          {PLAN_GRAPHIC_ELEMENT_ASSETS.map((asset) => (
            <button
              key={asset.id}
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
              onClick={() => onAddGraphicElement(asset.id)}
            >
              <img
                src={asset.svgPath}
                alt=""
                className="h-5 w-5 shrink-0 object-contain dark:invert"
              />
              <span>{t(asset.labelKey, asset.label)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
