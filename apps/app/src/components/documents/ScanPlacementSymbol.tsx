import { SymbolPreview } from '@/components/library/SymbolItem'
import { getSymbolById } from '@/lib/symbols'

/** Use the same themed artwork and double-socket preview as the editor library. */
export function ScanPlacementSymbol({ symbolId, quantity, compact = false }: { symbolId: string; quantity: number; compact?: boolean }) {
  const socket = symbolId === 'socket_gnd_child'
  const id = socket && quantity === 2 ? 'double_socket_gnd_child' : symbolId
  const symbol = getSymbolById(id)
  const copies = socket && quantity > 2 && !compact ? quantity : 1
  return <span className="inline-flex shrink-0 items-center" aria-hidden="true">
    {Array.from({ length: copies }, (_, index) => <SymbolPreview key={index} svgPath={symbol?.svgPath ?? ''} symbolId={id} />)}
  </span>
}
