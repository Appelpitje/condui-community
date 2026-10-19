import { useEffect, useRef, useState } from 'react'
import type { ContextMenuItem } from '@/components/common/ContextMenu'
import { createPortal } from 'react-dom'
import { useCanvasWindow } from '@/components/viewport/ViewportContext'

interface ContextMenuPortalProps {
  position: { x: number; y: number }
  items: ContextMenuItem[]
  onClose: () => void
}

function ContextMenuPortal({ position, items, onClose }: ContextMenuPortalProps) {
  const window = useCanvasWindow()
  const document = window.document
  const menuRef = useRef<HTMLDivElement>(null)
  const lastPointerActivationRef = useRef(0)
  const [adjustedPosition, setAdjustedPosition] = useState(position)

  const activateItem = (item: ContextMenuItem) => {
    if (item.disabled) return
    item.onClick()
    onClose()
  }

  // Adjust position to keep menu within viewport
  useEffect(() => {
    if (!menuRef.current) return

    const menu = menuRef.current
    const rect = menu.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight

    let x = position.x
    let y = position.y

    // Adjust horizontal position
    if (x + rect.width > viewportWidth) {
      x = viewportWidth - rect.width - 8
    }
    if (x < 8) {
      x = 8
    }

    // Adjust vertical position
    if (y + rect.height > viewportHeight) {
      y = viewportHeight - rect.height - 8
    }
    if (y < 8) {
      y = 8
    }

    setAdjustedPosition({ x, y })
  }, [position, window])

  // Close menu on Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onClose, document])

  const filteredItems = items.filter((item) => item !== null)

  if (filteredItems.length === 0) return null

  return createPortal(
    <div
      ref={menuRef}
      data-canvas-context-menu="true"
      className="fixed z-50 min-w-[180px] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg py-1"
      style={{
        left: `${adjustedPosition.x}px`,
        top: `${adjustedPosition.y}px`,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {filteredItems.map((item, index) => {
        if (item.separator) {
          return (
            <div
              key={`separator-${index}`}
              className="my-1 border-t border-gray-200 dark:border-gray-700"
            />
          )
        }

        return (
          <button
            key={index}
            onPointerUp={(event) => {
              if (event.pointerType === 'mouse') return
              lastPointerActivationRef.current = performance.now()
              event.preventDefault()
              event.stopPropagation()
              activateItem(item)
            }}
            onClick={() => {
              if (performance.now() - lastPointerActivationRef.current < 400) return
              activateItem(item)
            }}
            disabled={item.disabled}
            className={`w-full text-left px-3 py-1.5 text-sm flex items-center transition-colors ${
              item.disabled
                ? 'text-gray-400 dark:text-gray-600 cursor-not-allowed'
                : item.variant === 'danger'
                  ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
          >
            <span className="inline-flex w-4 h-4 items-center justify-center mr-2">
              {item.icon ?? null}
            </span>
            <span>{item.label}</span>
          </button>
        )
      })}
    </div>,
    document.body
  )
}

export default ContextMenuPortal
