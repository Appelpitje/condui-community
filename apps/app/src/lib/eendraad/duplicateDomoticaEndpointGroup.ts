import {
  clonePlacementsForDuplicate,
  clonePlacementsOptionsForEndpoint,
} from '@/lib/eendraad/duplicateSitplanHelpers'
import type { Circuit, DomoticaChildEndpointProps, Endpoint } from '@/types/schema'
import { generateId } from '@/utils'
import { clearDuplicatedControlChannel } from '@/lib/controlLink/duplicateAddress'

export type DomoticaEndpointGroupClone = {
  parent: Endpoint
  children: Endpoint[]
  childIdMap: Map<string, string>
}

function cloneEndpoint(source: Endpoint, id: string, newId: () => string): Endpoint {
  const clone: Endpoint = JSON.parse(JSON.stringify(source))
  clone.id = id
  clone.placements = source.placements?.length
    ? clonePlacementsForDuplicate(source.placements, clonePlacementsOptionsForEndpoint(source), newId)
    : []
  return clone
}

function remapEndpointIds(
  ids: string[] | undefined,
  idMap: Map<string, string>
): string[] | undefined {
  if (!ids) return undefined
  return ids.map((id) => idMap.get(id)).filter((id): id is string => !!id)
}

function remapSlots(ids: string[] | undefined, idMap: Map<string, string>): string[] | undefined {
  if (!ids) return undefined
  return ids.map((id) => (id ? (idMap.get(id) ?? '') : ''))
}

function endpointOrderForGroup(circuit: Circuit, childIds: Set<string>): string[] {
  const ordered: string[] = []
  const seen = new Set<string>()
  const add = (id: string) => {
    if (childIds.has(id) && !seen.has(id)) {
      seen.add(id)
      ordered.push(id)
    }
  }

  for (const branch of circuit.branches ?? []) {
    for (const id of branch.endpointIds ?? []) add(id)
  }
  for (const endpoint of circuit.endpoints) add(endpoint.id)
  return ordered
}

function slotRefsForParent(parent: Endpoint): Map<string, DomoticaChildEndpointProps> {
  const refs = new Map<string, DomoticaChildEndpointProps>()
  const props = parent.domoticaProps
  for (const [group, ids] of [
    ['endpoint', props?.endpointChildEndpointIds],
    ['control', props?.controlChildEndpointIds],
  ] as const) {
    for (let index = 0; index < (ids?.length ?? 0); index++) {
      const id = ids?.[index]
      if (!id || refs.has(id)) continue
      refs.set(id, {
        parentEndpointId: parent.id,
        outputGroup: group,
        outputIndex: index,
      })
    }
  }
  return refs
}

/**
 * Clone a domotica parent and every endpoint directly owned by it.
 *
 * The returned objects are detached from the source circuit and every endpoint
 * in the group has a fresh ID. Child order follows the source branch order so
 * callers can insert the copied group as one contiguous block.
 */
export function cloneDomoticaEndpointGroup(
  sourceParent: Endpoint,
  sourceCircuit: Circuit,
  newId: () => string = generateId,
): DomoticaEndpointGroupClone {
  const slotRefs = slotRefsForParent(sourceParent)
  const childIds = new Set(slotRefs.keys())
  for (const endpoint of sourceCircuit.endpoints) {
    if (endpoint.domoticaChildProps?.parentEndpointId === sourceParent.id) {
      childIds.add(endpoint.id)
    }
  }

  const sourceChildren = sourceCircuit.endpoints.filter((endpoint) => childIds.has(endpoint.id))
  const childrenById = new Map(sourceChildren.map((endpoint) => [endpoint.id, endpoint]))
  const sourceChildrenInOrder = endpointOrderForGroup(sourceCircuit, childIds)
    .map((id) => childrenById.get(id))
    .filter((endpoint): endpoint is Endpoint => !!endpoint)

  const parentId = newId()
  const childIdMap = new Map<string, string>()
  for (const child of sourceChildrenInOrder) childIdMap.set(child.id, newId())

  const parent = cloneEndpoint(sourceParent, parentId, newId)
  // Domotica parents are diagram modules, not sitplan symbols.
  parent.placements = []
  if (parent.domoticaProps) {
    parent.domoticaProps = {
      ...parent.domoticaProps,
      endpointChildEndpointIds: remapSlots(
        sourceParent.domoticaProps?.endpointChildEndpointIds,
        childIdMap
      ),
      controlChildEndpointIds: remapSlots(
        sourceParent.domoticaProps?.controlChildEndpointIds,
        childIdMap
      ),
    }
  }
  parent.controlledEndpointIds = remapEndpointIds(sourceParent.controlledEndpointIds, childIdMap)

  const children = sourceChildrenInOrder.map((sourceChild) => {
    const child = cloneEndpoint(sourceChild, childIdMap.get(sourceChild.id)!, newId)
    const sourceRef = sourceChild.domoticaChildProps ?? slotRefs.get(sourceChild.id)
    if (sourceRef) {
      child.domoticaChildProps = {
        ...sourceRef,
        parentEndpointId: parentId,
      }
    }
    child.controlledEndpointIds = remapEndpointIds(sourceChild.controlledEndpointIds, childIdMap)
    return child
  })

  const endpointIdMap = new Map([[sourceParent.id, parentId], ...childIdMap])
  for (const endpoint of [parent, ...children]) {
    if (endpoint.controlLink) {
      const clonedDeviceId = endpointIdMap.get(endpoint.controlLink.deviceId)
      if (clonedDeviceId) endpoint.controlLink.deviceId = clonedDeviceId
      else delete endpoint.controlLink
    }
    clearDuplicatedControlChannel(endpoint)
  }

  return { parent, children, childIdMap }
}
