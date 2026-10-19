import { z } from 'zod'

/** Public, read-only lookup contract shared by CLI and every assistant transport. */
export const validationHelpQuerySchema = z.strictObject({
  ruleId: z.string().min(1).max(200),
  language: z.string().min(1).max(20).optional(),
  offset: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(6000).default(4000),
})
