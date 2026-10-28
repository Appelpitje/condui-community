import type { CableSpec, Endpoint, ProtectionDevice, TrunkDevice } from '@/types/schema'
import { polesFromConfig } from '@/constants/poleConfig'
import reference from './etim10.json'

/**
 * etim10.json is a curated subset of the official ETIM English metric release,
 * attributed to ETIM International under ODC-By 1.0. Its source URL and archive
 * SHA-256 are recorded in the file. Feature lists are deliberately partial.
 * The export is a classified quantity list, not an xChange product catalogue.
 */

export const ETIM_RELEASE = reference.release
export const ETIM_ATTRIBUTION =
  'ETIM International, ETIM 10.0; https://www.etim-international.com/; ODC-By 1.0: https://opendatacommons.org/licenses/by/1-0/'

export interface EtimClassification {
  classCode: keyof typeof reference.classes
  className: string
  classVersion: number
  /** EF codes with numeric/logical values or EV codes; units are defined by ETIM 10.0. */
  features: Record<string, string | number | boolean>
}

type ClassCode = EtimClassification['classCode']
type FeatureValue = string | number | boolean | undefined

function classify(
  classCode: ClassCode,
  candidates: Record<string, FeatureValue> = {}
): EtimClassification {
  const definition = reference.classes[classCode]
  const definitions: Record<string, { type: string; values?: Record<string, string> }> =
    definition.features
  const features: EtimClassification['features'] = {}
  for (const [id, value] of Object.entries(candidates)) {
    const feature = definitions[id]
    if (!feature || value === undefined) continue
    if (feature.type === 'N' && typeof value === 'number' && Number.isFinite(value) && value > 0)
      features[id] = value
    if (feature.type === 'L' && typeof value === 'boolean') features[id] = value
    if (feature.type === 'A' && typeof value === 'string') {
      const code = Object.entries(feature.values ?? {}).find(([, name]) => name === value)?.[0]
      if (code) features[id] = code
    }
  }
  return { classCode, className: definition.name, classVersion: definition.version, features }
}

/** Keep unspecified ratings and ambiguous breaking-capacity test standards out of ETIM. */
export function classifyEtimProtection(
  device: ProtectionDevice | TrunkDevice
): EtimClassification | undefined {
  const type = device.type === 'protection' ? device.protectionType : device.type
  const code =
    type === 'MCB'
      ? 'EC000042'
      : type === 'RCD'
        ? 'EC000003'
        : type === 'RCBO'
          ? 'EC000905'
          : undefined
  if (!code) return undefined
  return classify(code, {
    EF000227: device.ratingA,
    [type === 'RCD' ? 'EF001391' : 'EF008618']: device.polesConfig
      ? polesFromConfig(device.polesConfig)
      : undefined,
    EF000889: device.curve,
    EF002358: device.sensitivityMa == null ? undefined : device.sensitivityMa / 1000,
    EF002560: device.residualCurrentType,
    EF002561: device.selective,
  })
}

export function classifyEtimEndpoint(endpoint: Endpoint): EtimClassification | undefined {
  if (endpoint.domoticaProps) return undefined
  const symbol = endpoint.symbol ?? (endpoint.type === 'switch' ? 'switch' : undefined)
  if (
    endpoint.type === 'socket' &&
    (!symbol || ['socket', 'socket_gnd', 'socket_child', 'socket_gnd_child'].includes(symbol))
  ) {
    // Combined switch/socket assemblies have their own class; do not call them plain outlets.
    if (endpoint.socketProps?.switchOverlay || endpoint.socketProps?.switchOverlayLock)
      return undefined
    return classify('EC000125', { EF000336: endpoint.socketProps?.socketCount ?? 1 })
  }
  if (symbol === 'switch_dimmer') return classify('EC000025')
  if (symbol === 'switch_impulse') return classify('EC000029')
  if (symbol === 'motion_detector') return classify('EC000133')
  if (symbol === 'smoke_detector') {
    const type = endpoint.smokeDetectorProps?.type ?? 'smoke'
    return type === 'gas' || type === 'manual' ? undefined : classify('EC001763')
  }
  const poleWiring =
    endpoint.switchProps?.poles === 4
      ? undefined
      : endpoint.switchProps?.poles === 3
        ? 'Switch 3-pole'
        : endpoint.switchProps?.poles === 2
          ? 'Switch 2-pole'
          : 'Switch 1-pole'
  const wiring: Partial<Record<NonNullable<Endpoint['symbol']>, string>> = {
    switch: poleWiring,
    switch_1p_pull: poleWiring,
    switch_1p_twoway: endpoint.switchProps?.twoPole ? undefined : 'Two-way switch',
    switch_1p_changeover: undefined,
    switch_cross: 'Intermediate switch',
  }
  if (endpoint.type === 'switch' && (symbol === 'switch_2p_twoway' || (symbol && symbol in wiring)))
    return classify('EC001590', { EF002960: symbol ? wiring[symbol] : undefined })
  return undefined
}

export function classifyEtimCable(cable: CableSpec): EtimClassification | undefined {
  const code = ['XVB', 'XGB', 'EXVB'].includes(cable.kind)
    ? 'EC003248'
    : ['VOB', 'VOBst', 'H07V-K'].includes(cable.kind)
      ? 'EC000993'
      : cable.kind === 'H07RN-F'
        ? 'EC003250'
        : undefined
  if (!code) return undefined
  // A multi-wire VOB run is a bundle, not this many metres of one single-core product.
  if (code === 'EC000993' && cable.conductors !== 1) return undefined
  return classify(code, {
    EF000060: cable.sectionMm2,
    EF001792: cable.conductors,
    EF007468: cable.hasPE,
  })
}

export function classifyEtimEnergyMeter(): EtimClassification {
  return classify('EC001506')
}
