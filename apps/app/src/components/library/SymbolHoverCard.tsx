import { useLayoutEffect, useRef, useState, type FocusEvent } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import { ArrowUpRight } from 'lucide-react'
import { getSymbolReferenceDescription, getSymbolReferenceUrl, hasSymbolReferenceIllustration } from '@/lib/symbolReference'

interface SymbolHoverCardProps {
  id: string
  symbolId: string
  name: string
  fallback: string
  anchor: DOMRect
  onEnter: () => void
  onLeave: () => void
}

export function SymbolHoverCard({ id, symbolId, name, fallback, anchor, onEnter, onLeave }: SymbolHoverCardProps) {
  const { t, i18n } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: 8, top: 8 })
  const description = getSymbolReferenceDescription(symbolId, i18n.language)

  useLayoutEffect(() => {
    const card = ref.current
    if (!card) return
    const { width, height } = card.getBoundingClientRect()
    const right = anchor.right + 10
    const left = right + width <= window.innerWidth - 8 ? right : anchor.left - width - 10
    setPosition({
      left: Math.max(8, Math.min(left, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(anchor.top, window.innerHeight - height - 8)),
    })
  }, [anchor, description, i18n.language])

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) onLeave()
  }

  return createPortal(
    <div role="presentation" className="contents" onKeyDown={(event) => event.stopPropagation()}>
    <div
      ref={ref}
      id={id}
      role="dialog"
      aria-label={name}
      data-symbol-hover-card="true"
      data-app-scroll="true"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onFocus={onEnter}
      onBlur={handleBlur}
      className="fixed z-[9999] w-80 max-w-[calc(100vw-16px)] max-h-[calc(100vh-16px)] overflow-y-auto rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-700 shadow-xl dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
      style={position}
    >
      {hasSymbolReferenceIllustration(symbolId) && (
        <div className="mb-3 rounded-lg bg-slate-50 p-2 dark:bg-slate-900/50">
          <img src={`/media/symbols/${symbolId}.svg`} alt="" className="h-28 w-full object-contain dark:hidden" />
          <img src={`/media/symbols/${symbolId}-dark.svg`} alt="" className="hidden h-28 w-full object-contain dark:block" />
        </div>
      )}
      <div className="mb-2 font-semibold text-gray-900 dark:text-white">{name}</div>
      <div className="space-y-2 leading-relaxed [&_a]:text-sky-600 [&_a]:underline [&_ul]:list-disc [&_ul]:pl-4">
        <ReactMarkdown>{description ?? fallback}</ReactMarkdown>
      </div>
      {description && (
        <a
          href={getSymbolReferenceUrl(symbolId, i18n.language)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1 rounded text-sm font-medium text-sky-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500 dark:text-sky-300"
        >
          {t('common.more')} <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      )}
    </div>
    </div>,
    document.body,
  )
}
