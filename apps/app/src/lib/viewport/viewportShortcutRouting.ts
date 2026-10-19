import type { CommandContext } from '@/lib/commands/ui/types'

export interface ViewportShortcutTarget {
  viewport: NonNullable<CommandContext['viewport']>
  capabilities: CommandContext['capabilities']
  getPointerPanelIndex: () => number | null
}

type ShortcutKey = Pick<
  KeyboardEvent,
  'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'
>

/** Canvas navigation, tools, circuit/floor shortcuts and in-canvas numeric editors.
 * Browser and global project commands retain their normal focused-window behavior. */
export function isHoverCanvasShortcut(event: ShortcutKey) {
  if (event.altKey) return false
  if (event.ctrlKey || event.metaKey) return !event.shiftKey && /^[cvd]$/i.test(event.key)
  return (
    /^[a-z0-9.,+=-]$/i.test(event.key) ||
    /^F[1-4]$/.test(event.key) ||
    /^Arrow(Up|Down|Left|Right)$/.test(event.key) ||
    ['Escape', 'Enter', 'Backspace', 'Delete', 'Shift', 'Tab'].includes(event.key) ||
    (!event.shiftKey && (event.key === ' ' || event.code === 'Space'))
  )
}

/** Shared by the main editor and its popup listeners; hovering does not steal OS focus. */
export class ViewportShortcutRouter {
  private hovered: ViewportShortcutTarget | null = null
  private held = new Map<string, ViewportShortcutTarget>()

  hover(target: ViewportShortcutTarget) {
    this.hovered = target
  }

  isHoveredViewport(ownerWindow: Window, panelIndex: number) {
    return (
      this.hovered?.viewport.getOwnerWindow() === ownerWindow &&
      this.hovered.getPointerPanelIndex() === panelIndex
    )
  }

  leave(target: ViewportShortcutTarget) {
    if (this.hovered === target) this.hovered = null
  }

  remove(target: ViewportShortcutTarget) {
    this.leave(target)
    for (const [key, owner] of this.held) if (owner === target) this.held.delete(key)
  }

  resolve(event: ShortcutKey, focused: ViewportShortcutTarget) {
    if (!isHoverCanvasShortcut(event) || !this.hovered) return focused
    if (this.hovered.viewport.getOwnerWindow().closed) {
      this.hovered = null
      return focused
    }
    return this.hovered.getPointerPanelIndex() == null ? focused : this.hovered
  }

  press(event: ShortcutKey & { repeat: boolean }, focused: ViewportShortcutTarget) {
    const key = event.code || event.key
    const held = this.held.get(key)
    if (event.repeat && held && !held.viewport.getOwnerWindow().closed) return held
    const target = this.resolve(event, focused)
    if (isHoverCanvasShortcut(event)) this.held.set(key, target)
    return target
  }

  release(event: ShortcutKey, focused: ViewportShortcutTarget) {
    const key = event.code || event.key
    const target = this.held.get(key)
    this.held.delete(key)
    return target && !target.viewport.getOwnerWindow().closed ? target : focused
  }
}

export const viewportShortcutRouter = new ViewportShortcutRouter()
// A forwarded native event passes the target window's capture listener exactly once.
export const forwardedViewportKeys = new WeakSet<KeyboardEvent>()
