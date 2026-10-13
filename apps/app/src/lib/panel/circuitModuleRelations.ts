import type { Circuit, TrunkDevice } from '@/types/schema'

/** A trunk at position k follows branch k-1; earlier branch taps bypass it. */
export function getCircuitEndpointTrunkParent(
  circuit: Circuit | null | undefined,
  endpointId: string
): TrunkDevice | null {
  if (!circuit) return null
  const branchIndex =
    circuit.branches?.findIndex((branch) => branch.endpointIds.includes(endpointId)) ?? -1
  const trunks = [...(circuit.trunkDevices ?? [])].sort(
    (a, b) => (a.trunkPosition ?? 0) - (b.trunkPosition ?? 0)
  )
  // Unbranched endpoints retain the circuit's final trunk as their source.
  return (
    trunks
      .filter((device) => branchIndex < 0 || (device.trunkPosition ?? 0) <= branchIndex)
      .at(-1) ?? null
  )
}
