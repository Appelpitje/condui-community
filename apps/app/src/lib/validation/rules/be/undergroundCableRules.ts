import type { RuleDef } from '../../core/types'

export const undergroundCableRules: RuleDef[] = [{
  id: 'be.areibook1.2025.underground-cable-conduit',
  title: 'Protect underground XVB cables with conduit',
  severity: 'info',
  appliesTo: ['circuit'],
  checks: [{ name: 'undergroundCableConduit' }],
  message: 'validation.primitives.undergroundCable.message',
  details: 'validation.primitives.undergroundCable.details',
  // Manufacturer installation advice, not an automatically established AREI violation.
  citations: [],
  tags: ['cable', 'installation', 'advisory'],
}]
