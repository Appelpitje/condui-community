#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { getValidationHelp } from '../src/lib/validation/validationHelp.ts'
import { validationHelpQuerySchema } from '../src/lib/validation/validationHelpQuery.ts'

const USAGE = `Read bundled AREI article help without a project, browser, account or network.

Usage:
  npm run validation:help -- --query <query.json>
  node apps/app/scripts/validation-help-cli.mjs <query.json>

Query JSON:
  {"ruleId":"be.areibook1.2025.main-rcd","language":"en","offset":0,"limit":4000}

Pages contain at most 6000 UTF-16 characters. Follow content.nextOffset for more.
The source is an offline bundled snapshot; its hashes identify the exact content.
`

/** Keep the Community entry point independent of the editor, transport and provider. */
export function parseValidationHelpArguments(args) {
  if (args.length === 1 && args[0] === '--help') return { help: true }
  let queryFile
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]
    if (argument === '--query') {
      if (queryFile) throw new Error('Specify exactly one query JSON file.')
      queryFile = args[++index]
      if (!queryFile || queryFile.startsWith('--')) throw new Error('--query requires a JSON file.')
    } else if (argument.startsWith('-')) {
      throw new Error(`Unknown option: ${argument}`)
    } else {
      if (queryFile) throw new Error('Specify exactly one query JSON file.')
      queryFile = argument
    }
  }
  if (!queryFile) throw new Error('Supply a query JSON file. Use --help for usage.')
  return { help: false, queryFile }
}

export async function main(args = process.argv.slice(2), output = process.stdout) {
  const options = parseValidationHelpArguments(args)
  if (options.help) {
    output.write(USAGE)
    return
  }
  const input = JSON.parse(await readFile(resolve(options.queryFile), 'utf8'))
  const query = validationHelpQuerySchema.parse(input)
  const result = getValidationHelp(query)
  output.write(`${JSON.stringify({ ok: result.status === 'available', ...result }, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main() }
  catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Validation help lookup failed.'}\n`)
    process.exitCode = 1
  }
}
