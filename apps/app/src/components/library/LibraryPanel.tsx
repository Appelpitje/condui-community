import { getLocalizedSymbolName } from '@/lib/symbolNames'
import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useMemo,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { Search, ChevronDown, ChevronRight, Star, Clock, X } from 'lucide-react'
import { useLibraryStore } from '@/stores/libraryStore'
import { useViewportWindowStore } from '@/components/viewport/ViewportWindowStore'
import { symbolCategories } from '@/lib/symbols'
import SymbolItem from './SymbolItem'
import type { SymbolMetadata } from '@/lib/symbols'
import { canSymbolAppearOnSituationPlan } from '@/lib/plan/situationPlanSymbolEligibility'
import { getSymbolLibraryTooltip } from '@/lib/symbolTooltips'
import { MODULAR_SOCKET_LIBRARY_ID } from '@/lib/socket/modularSocket'
import {
  LIBRARY_JUMP_CATEGORIES,
  nextLibraryCategoryFilter,
  resolveJumpCategory,
} from '@/lib/library/libraryCategoryJump'

/** Categories shown in the library when panel canvas is maximized */
const PANEL_VIEW_CATEGORIES = [
  'protection',
  'outlets',
  'domotica',
  'metering',
  'notes',
  'grid',
] as const
const SEARCH_COMMIT_DELAY_MS = 120
const JUMP_TOOLTIP_DELAY_MS = 350

interface LibrarySearchFieldProps {
  query: string
  onCommit: (query: string) => void
  placeholder: string
  wrapperClassName?: string
  inputClassName: string
  iconClassName: string
  clearButtonClassName: string
  clearIconClassName: string
  /** Content inside the field after the search icon, such as the category filter chip. */
  leading?: ReactNode
  onBackspaceEmpty?: () => void
}

function LibrarySearchField({
  query,
  onCommit,
  placeholder,
  wrapperClassName = 'relative',
  inputClassName,
  iconClassName,
  clearButtonClassName,
  clearIconClassName,
  leading,
  onBackspaceEmpty,
}: LibrarySearchFieldProps) {
  const [draft, setDraft] = useState(query)
  const leadingRef = useRef<HTMLDivElement>(null)
  const [leadingWidth, setLeadingWidth] = useState(0)

  useLayoutEffect(() => {
    setLeadingWidth(leading ? leadingRef.current?.offsetWidth ?? 0 : 0)
  }, [leading])

  useEffect(() => {
    setDraft(query)
  }, [query])

  useEffect(() => {
    if (draft === query) return
    const timeout = window.setTimeout(() => onCommit(draft), SEARCH_COMMIT_DELAY_MS)
    return () => window.clearTimeout(timeout)
  }, [draft, onCommit, query])

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace' && !draft) onBackspaceEmpty?.()
    if (event.key !== 'Enter') return
    onCommit(draft)
    event.currentTarget.blur()
  }

  const handleFocus = (event: FocusEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    window.setTimeout(() => {
      input.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }, 60)
  }

  const clear = () => {
    setDraft('')
    onCommit('')
  }

  return (
    <div className={wrapperClassName}>
      <Search className={iconClassName} />
      {leading && (
        <div ref={leadingRef} className="absolute left-8 top-1/2 -translate-y-1/2">
          {leading}
        </div>
      )}
      <input
        type="search"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        enterKeyHint="search"
        placeholder={placeholder}
        style={leading ? { paddingLeft: leadingWidth + 38 } : undefined}
        // Hide the native WebKit clear button; the X button below already clears the query.
        className={`${inputClassName} [&::-webkit-search-cancel-button]:appearance-none`}
      />
      {draft && (
        <button type="button" onClick={clear} className={clearButtonClassName}>
          <X className={clearIconClassName} />
        </button>
      )}
    </div>
  )
}

interface LibraryJumpButtonProps {
  label: string
  iconPath: string
  filtered: boolean
  dimmed: boolean
  current: boolean
  onClick: (event: MouseEvent<HTMLButtonElement>) => void
}

function LibraryJumpButton({ label, iconPath, filtered, dimmed, current, onClick }: LibraryJumpButtonProps) {
  const { t } = useTranslation()
  const [showTooltip, setShowTooltip] = useState(false)
  const [tooltipLeft, setTooltipLeft] = useState(0)
  const timeoutRef = useRef<number | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)

  const clearTooltip = () => {
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current)
    timeoutRef.current = null
    setShowTooltip(false)
  }

  useEffect(() => clearTooltip, [])

  // Centre the tooltip under the button, but keep it inside the shortcut row.
  useLayoutEffect(() => {
    const wrapper = wrapperRef.current
    const tooltip = tooltipRef.current
    const row = wrapper?.closest('[data-library-jump-row]')
    if (!showTooltip || !wrapper || !tooltip || !row) return
    const wrapperRect = wrapper.getBoundingClientRect()
    const rowRect = row.getBoundingClientRect()
    tooltip.style.maxWidth = `${rowRect.width}px`
    const centered = wrapperRect.left + (wrapperRect.width - tooltip.offsetWidth) / 2
    const clamped = Math.max(rowRect.left, Math.min(centered, rowRect.right - tooltip.offsetWidth))
    setTooltipLeft(clamped - wrapperRect.left)
  }, [showTooltip])

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-pressed={filtered}
        onClick={(event) => {
          clearTooltip()
          onClick(event)
        }}
        onMouseEnter={() => {
          clearTooltip()
          timeoutRef.current = window.setTimeout(() => setShowTooltip(true), JUMP_TOOLTIP_DELAY_MS)
        }}
        onMouseLeave={clearTooltip}
        className={`relative flex h-7 w-full items-center justify-center rounded transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
          filtered ? 'bg-gray-900 dark:bg-white' : 'hover:bg-gray-100 dark:hover:bg-gray-700'
        } ${dimmed ? 'opacity-40 hover:opacity-100' : ''}`}
      >
        <img
          src={iconPath}
          alt=""
          draggable={false}
          className={`pointer-events-none h-5 w-5 ${filtered ? 'invert dark:invert-0' : 'dark:invert'}`}
        />
        <span
          className={`absolute inset-x-1.5 -bottom-1.5 h-0.5 rounded-full ${
            current ? 'bg-gray-900 dark:bg-white' : 'bg-transparent'
          }`}
        />
      </button>
      {showTooltip && (
        <div
          ref={tooltipRef}
          role="tooltip"
          style={{ left: tooltipLeft }}
          className="pointer-events-none absolute top-full z-20 mt-1.5 w-max rounded-md bg-gray-900 px-2 py-1 text-xs text-white shadow-lg dark:bg-gray-100 dark:text-gray-900"
        >
          <div className="font-medium">{label}</div>
          <div className="text-[11px] text-gray-300 dark:text-gray-600">{t('symbols.jump.filterOnly')}</div>
          <div className="text-[11px] text-gray-300 dark:text-gray-600">{t('symbols.jump.filterAdd')}</div>
        </div>
      )}
    </div>
  )
}

interface LibraryPanelProps {
  onDragStart?: (symbol: SymbolMetadata) => void
  compact?: boolean
  compactOrientation?: 'portrait' | 'landscape'
}

function LibraryPanel({
  onDragStart,
  compact = false,
  compactOrientation = 'portrait',
}: LibraryPanelProps) {
  const { t, i18n } = useTranslation()
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(Object.keys(symbolCategories))
  )
  const [activeTab, setActiveTab] = useState<'all' | 'recent' | 'favorites'>('all')
  const [categoryFilter, setCategoryFilter] = useState<Set<string>>(() => new Set())
  const [currentCategory, setCurrentCategory] = useState<string | null>(null)
  const [pendingJump, setPendingJump] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const searchQuery = useLibraryStore((state) => state.searchQuery)
  const setSearchQuery = useLibraryStore((state) => state.setSearchQuery)
  const getFilteredSymbols = useLibraryStore((state) => state.getFilteredSymbols)
  const getSymbolsByCategory = useLibraryStore((state) => state.getSymbolsByCategory)
  const recentSymbols = useLibraryStore((state) => state.recentSymbols)
  const favoriteSymbols = useLibraryStore((state) => state.favoriteSymbols)
  const getSymbolById = useLibraryStore((state) => state.getSymbolById)
  const toggleFavorite = useLibraryStore((state) => state.toggleFavorite)
  const viewMode = useViewportWindowStore((state) => state.viewMode)

  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(category)) {
        next.delete(category)
      } else {
        next.add(category)
      }
      return next
    })
  }

  const getLocalizedName = (symbol: SymbolMetadata) => {
    const locale = i18n.language
    return getLocalizedSymbolName(symbol, locale)
  }

  const getRecentSymbolsList = () => {
    return recentSymbols.map((id) => getSymbolById(id)).filter(Boolean) as SymbolMetadata[]
  }

  const getFavoriteSymbolsList = () => {
    return favoriteSymbols.map((id) => getSymbolById(id)).filter(Boolean) as SymbolMetadata[]
  }

  const filterByScope = (symbols: SymbolMetadata[]) => {
    if (viewMode === 'eendraad') {
      return symbols.filter((s) => s.scope === 'eendraad' || s.scope === 'both')
    }
    if (viewMode === 'plan') {
      return symbols.filter((s) => canSymbolAppearOnSituationPlan(s.id))
    }
    if (viewMode === 'panel') {
      return symbols.filter(
        (s) =>
          s.id === MODULAR_SOCKET_LIBRARY_ID ||
          (PANEL_VIEW_CATEGORIES.includes(s.category as (typeof PANEL_VIEW_CATEGORIES)[number]) &&
            s.category !== 'outlets' &&
            (s.category !== 'grid' || s.id === 'panel_distribution')) ||
          s.id === 'panel_distribution'
      )
    }
    return symbols
  }

  const categoriesToShow = useMemo(() => {
    if (viewMode === 'panel') {
      return Object.fromEntries(
        PANEL_VIEW_CATEGORIES.filter((key) => key in symbolCategories).map((key) => [key, symbolCategories[key as keyof typeof symbolCategories]])
      )
    }
    return symbolCategories
  }, [viewMode])

  const renderSymbol = (symbol: SymbolMetadata) => (
    <SymbolItem
      key={symbol.id}
      symbol={symbol}
      onDragStart={onDragStart}
      localizedName={getLocalizedName(symbol)}
      tooltip={getSymbolLibraryTooltip(symbol.id, i18n.language)}
      isFavorite={favoriteSymbols.includes(symbol.id)}
      onToggleFavorite={toggleFavorite}
      compact={compact}
    />
  )

  const visibleSymbols = filterByScope(getFilteredSymbols(i18n.language))
  const inCategoryFilter = (category: string) => categoryFilter.size === 0 || categoryFilter.has(category)
  const categoryVisibleSymbols = visibleSymbols.filter((symbol) => inCategoryFilter(symbol.category))
  const categoryOrder = Object.keys(categoriesToShow)
  const jumpCategories = LIBRARY_JUMP_CATEGORIES.filter(
    ({ category }) => category in categoriesToShow && filterByScope(getSymbolsByCategory(category)).length > 0
  )

  const updateCurrentCategory = () => {
    const list = listRef.current
    if (!list) return
    let section: string | null = null
    for (const element of list.querySelectorAll<HTMLElement>('[data-library-section]')) {
      if (section === null || element.offsetTop - list.scrollTop <= 12) section = element.dataset.librarySection ?? null
    }
    setCurrentCategory(resolveJumpCategory(categoryOrder, section))
  }

  useLayoutEffect(() => {
    if (compact) return
    const list = listRef.current
    if (pendingJump && list) {
      const section = list.querySelector<HTMLElement>(`[data-library-section="${pendingJump}"]`)
      if (section) list.scrollTo({ top: section.offsetTop - 8, behavior: 'smooth' })
      setPendingJump(null)
    }
    updateCurrentCategory()
    // updateCurrentCategory only reads the rendered list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compact, pendingJump, activeTab, searchQuery, categoryFilter, expandedCategories, viewMode])

  const handleJumpClick = (category: string, event: MouseEvent<HTMLButtonElement>) => {
    setActiveTab('all')
    const primary = event.ctrlKey || event.metaKey
    if (primary && event.shiftKey) {
      setCategoryFilter((prev) => nextLibraryCategoryFilter(prev, category, 'add'))
      listRef.current?.scrollTo({ top: 0 })
      return
    }
    if (primary || event.shiftKey || event.altKey) {
      setCategoryFilter((prev) => nextLibraryCategoryFilter(prev, category, 'only'))
      listRef.current?.scrollTo({ top: 0 })
      return
    }
    setCategoryFilter(new Set())
    setSearchQuery('')
    setExpandedCategories((prev) => (prev.has(category) ? prev : new Set(prev).add(category)))
    setPendingJump(category)
  }

  const clearCategoryFilter = () => setCategoryFilter(new Set())

  const filterChip =
    categoryFilter.size > 0 ? (
      <div className="flex items-center gap-1 rounded bg-gray-900 py-0.5 pl-1 pr-0.5 text-xs font-medium text-white dark:bg-white dark:text-gray-900">
        <span className="flex items-center gap-0.5">
          {LIBRARY_JUMP_CATEGORIES.filter(({ category }) => categoryFilter.has(category)).map(({ category, iconPath }) => (
            <img key={category} src={iconPath} alt="" className="h-4 w-4 invert dark:invert-0" />
          ))}
        </span>
        {categoryFilter.size === 1 && (
          <span className="max-w-[7rem] truncate">{t(`symbols.categories.${[...categoryFilter][0]}`)}</span>
        )}
        <button
          type="button"
          onClick={clearCategoryFilter}
          title={t('symbols.jump.clearFilter')}
          aria-label={t('symbols.jump.clearFilter')}
          className="rounded p-0.5 hover:bg-white/20 dark:hover:bg-gray-900/10"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    ) : null

  if (compact) {
    const compactSymbols = searchQuery
      ? visibleSymbols
      : activeTab === 'recent'
        ? filterByScope(getRecentSymbolsList())
        : activeTab === 'favorites'
          ? filterByScope(getFavoriteSymbolsList())
          : []
    const compactCategoryGroups = Object.entries(categoriesToShow)
      .map(([key]) => ({
        key,
        label: t(`symbols.categories.${key}`),
        symbols: filterByScope(getSymbolsByCategory(key)),
      }))
      .filter((group) => group.symbols.length > 0)
    const showCategoryGroups = activeTab === 'all' && !searchQuery

    if (compactOrientation === 'landscape') {
      return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden bg-white dark:bg-gray-800">
          <div className="flex flex-shrink-0 flex-col gap-2 border-b border-gray-200 px-2 py-2 dark:border-gray-700">
            <LibrarySearchField
              query={searchQuery}
              onCommit={setSearchQuery}
              placeholder={t('common.search')}
              inputClassName="w-full rounded-md border border-gray-300 bg-white py-1.5 pl-8 pr-7 text-sm text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
              iconClassName="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
              clearButtonClassName="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-600"
              clearIconClassName="h-4 w-4 text-gray-400"
            />
            <div className="flex rounded-md border border-gray-200 dark:border-gray-700">
              {(['all', 'recent', 'favorites'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`flex h-8 flex-1 items-center justify-center px-2 text-xs font-medium ${
                    activeTab === tab
                      ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                      : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
                  }`}
                  title={
                    tab === 'all' ? 'All' : tab === 'recent' ? t('symbols.recent') : t('symbols.favorites')
                  }
                >
                  {tab === 'all' ? 'All' : tab === 'recent' ? <Clock className="h-4 w-4" /> : <Star className="h-4 w-4" />}
                </button>
              ))}
            </div>
          </div>
          <div
            className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 py-2"
            data-library-scroll="true"
            style={{
              WebkitOverflowScrolling: 'touch',
              overscrollBehaviorY: 'contain',
              touchAction: 'pan-y',
            }}
          >
            {showCategoryGroups ? (
              <div className="space-y-3">
                {compactCategoryGroups.map((group) => (
                  <section key={group.key}>
                    <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      {group.label}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {group.symbols.map(renderSymbol)}
                    </div>
                  </section>
                ))}
              </div>
            ) : compactSymbols.length === 0 ? (
              <div className="flex min-h-[8rem] items-center justify-center text-sm text-gray-500 dark:text-gray-400">
                No symbols found
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">{compactSymbols.map(renderSymbol)}</div>
            )}
          </div>
        </div>
      )
    }

    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-white dark:bg-gray-800">
        <div className="flex flex-shrink-0 items-center gap-2 border-b border-gray-200 px-2 py-2 dark:border-gray-700">
          <LibrarySearchField
            query={searchQuery}
            onCommit={setSearchQuery}
            placeholder={t('common.search')}
            wrapperClassName="relative min-w-[9rem] flex-1"
            inputClassName="w-full rounded-md border border-gray-300 bg-white py-1.5 pl-8 pr-7 text-sm text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
            iconClassName="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
            clearButtonClassName="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-600"
            clearIconClassName="h-4 w-4 text-gray-400"
          />
          <div className="flex flex-shrink-0 rounded-md border border-gray-200 dark:border-gray-700">
            {(['all', 'recent', 'favorites'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`flex h-8 min-w-8 items-center justify-center px-2 text-xs font-medium ${
                  activeTab === tab
                    ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                    : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
                }`}
                title={tab === 'all' ? 'All' : tab === 'recent' ? t('symbols.recent') : t('symbols.favorites')}
              >
                {tab === 'all' ? 'All' : tab === 'recent' ? <Clock className="h-4 w-4" /> : <Star className="h-4 w-4" />}
              </button>
            ))}
          </div>
        </div>
        <div
          className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden px-2 py-2"
          data-library-scroll="true"
          style={{
            WebkitOverflowScrolling: 'touch',
            overscrollBehaviorX: 'contain',
            touchAction: 'pan-x',
          }}
        >
          <div className="flex h-full min-w-max items-start gap-3">
            {showCategoryGroups ? (
              compactCategoryGroups.map((group, index) => (
                <section
                  key={group.key}
                  className={`flex h-full flex-shrink-0 flex-col ${
                    index > 0 ? 'border-l border-gray-200 pl-3 dark:border-gray-700' : ''
                  }`}
                >
                  <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {group.label}
                  </div>
                  <div className="flex min-w-max items-start gap-2">
                    {group.symbols.map(renderSymbol)}
                  </div>
                </section>
              ))
            ) : compactSymbols.length === 0 ? (
              <div className="flex h-full min-w-[12rem] items-center justify-center text-sm text-gray-500 dark:text-gray-400">
                No symbols found
              </div>
            ) : (
              compactSymbols.map(renderSymbol)
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-white dark:bg-gray-800">
      {/* Search, tabs and category shortcuts */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2 px-3 pt-3 pb-2">
          <LibrarySearchField
            query={searchQuery}
            onCommit={setSearchQuery}
            placeholder={t('common.search')}
            wrapperClassName="relative min-w-0 flex-1"
            inputClassName="w-full rounded-md border border-gray-300 bg-white py-1.5 pl-8 pr-7 text-sm text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 dark:focus:ring-gray-400"
            iconClassName="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
            clearButtonClassName="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 transition-colors hover:bg-gray-100 dark:hover:bg-gray-600"
            clearIconClassName="h-4 w-4 text-gray-400"
            leading={filterChip}
            onBackspaceEmpty={clearCategoryFilter}
          />
          <div className="flex flex-shrink-0 rounded-md border border-gray-200 dark:border-gray-700">
            {(['all', 'recent', 'favorites'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`flex h-8 min-w-8 items-center justify-center px-2 text-xs font-medium ${
                  activeTab === tab
                    ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                    : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
                }`}
                title={tab === 'all' ? 'All' : tab === 'recent' ? t('symbols.recent') : t('symbols.favorites')}
              >
                {tab === 'all' ? 'All' : tab === 'recent' ? <Clock className="h-4 w-4" /> : <Star className="h-4 w-4" />}
              </button>
            ))}
          </div>
        </div>
        {jumpCategories.length > 1 && (
          <div
            data-library-jump-row="true"
            className="grid gap-0.5 px-2 pb-1.5"
            style={{ gridTemplateColumns: `repeat(${jumpCategories.length}, minmax(0, 1fr))` }}
          >
            {jumpCategories.map(({ category, iconPath }) => (
              <LibraryJumpButton
                key={category}
                label={t(`symbols.categories.${category}`)}
                iconPath={iconPath}
                filtered={categoryFilter.has(category)}
                dimmed={categoryFilter.size > 0 && !categoryFilter.has(category)}
                current={
                  categoryFilter.size === 0 && activeTab === 'all' && !searchQuery && currentCategory === category
                }
                onClick={(event) => handleJumpClick(category, event)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Symbol List */}
      <div
        ref={listRef}
        onScroll={updateCurrentCategory}
        className="relative flex-1 overflow-y-auto"
        data-library-scroll="true"
        style={{
          WebkitOverflowScrolling: 'touch',
          overscrollBehaviorY: 'contain',
          touchAction: 'pan-y',
        }}
      >
        {activeTab === 'all' && (
          <div className="p-2">
            {searchQuery ? (
              // Filtered view (flat list)
              <div className="space-y-0.25">
                {categoryVisibleSymbols.length === 0 ? (
                  <div className="p-4 text-center text-gray-500 dark:text-gray-400 text-sm">
                    No symbols found
                  </div>
                ) : (
                  categoryVisibleSymbols.map(renderSymbol)
                )}
              </div>
            ) : (
              // Category view
              <div className="space-y-2">
                {Object.entries(categoriesToShow).map(([key, _label]) => {
                  if (!inCategoryFilter(key)) return null
                  const categorySymbols = filterByScope(getSymbolsByCategory(key))
                  if (categorySymbols.length === 0) return null

                  const isExpanded = expandedCategories.has(key)

                  return (
                    <div key={key} data-library-section={key} className="border-b border-gray-100 dark:border-gray-700">
                      <button
                        onClick={() => toggleCategory(key)}
                        className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 rounded transition-colors"
                      >
                        <span className="font-medium text-sm text-gray-700 dark:text-gray-300">
                          {t(`symbols.categories.${key}`)}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {categorySymbols.length}
                          </span>
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-gray-500" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-gray-500" />
                          )}
                        </div>
                      </button>
                      {isExpanded && (
                        <div className="pb-2 space-y-0.5">
                          {categorySymbols.map(renderSymbol)}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === 'recent' && (
          <div className="p-2 space-y-0.5">
            {getRecentSymbolsList().length === 0 ? (
              <div className="p-4 text-center text-gray-500 dark:text-gray-400 text-sm">
                No recent symbols
              </div>
            ) : (
              filterByScope(getRecentSymbolsList()).map(renderSymbol)
            )}
          </div>
        )}

        {activeTab === 'favorites' && (
          <div className="p-2 space-y-0.5">
            {getFavoriteSymbolsList().length === 0 ? (
              <div className="p-4 text-center text-gray-500 dark:text-gray-400 text-sm">
                No favorite symbols
              </div>
            ) : (
              filterByScope(getFavoriteSymbolsList()).map(renderSymbol)
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {activeTab === 'all' && searchQuery
            ? `${categoryVisibleSymbols.length} symbols found`
            : activeTab === 'recent'
            ? `${getRecentSymbolsList().length} recent`
            : activeTab === 'favorites'
            ? `${getFavoriteSymbolsList().length} favorites`
            : `${categoryVisibleSymbols.length} symbols`}
        </div>
      </div>
    </div>
  )
}

export default memo(LibraryPanel)
