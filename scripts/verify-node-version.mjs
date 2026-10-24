import path from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const MINIMUM_NODE_VERSION = readFileSync(new URL('../.node-version', import.meta.url), 'utf8').trim()
const [REQUIRED_NODE_MAJOR, MINIMUM_NODE_MINOR, MINIMUM_NODE_PATCH] = MINIMUM_NODE_VERSION.split('.').map(Number)

export function assertSupportedNodeVersion(version = process.versions.node) {
  const [major, minor, patch] = version.split('.').map(Number)
  if (
    /^\d+\.\d+\.\d+$/.test(version) &&
    major === REQUIRED_NODE_MAJOR &&
    (minor > MINIMUM_NODE_MINOR || (minor === MINIMUM_NODE_MINOR && patch >= MINIMUM_NODE_PATCH))
  ) return

  throw new Error(
    `Eendra requires Node ${REQUIRED_NODE_MAJOR} LTS ${MINIMUM_NODE_VERSION} or newer within ${REQUIRED_NODE_MAJOR}.x; current runtime is Node ${version}. ` +
      'Use the version pinned in .nvmrc/.node-version before installing, developing, building, or testing.'
  )
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    assertSupportedNodeVersion()
    console.log(`Node ${process.versions.node} satisfies the Eendra Node ${REQUIRED_NODE_MAJOR} LTS minimum ${MINIMUM_NODE_VERSION}.`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
