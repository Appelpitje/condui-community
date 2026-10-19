import fs from 'node:fs'
import path from 'node:path'

export function loadLockfilePackages(lockfilePath) {
  const lockfile = JSON.parse(fs.readFileSync(lockfilePath, 'utf8'))
  if (!lockfile.packages || typeof lockfile.packages !== 'object') {
    throw new Error(`Lockfile is missing packages: ${lockfilePath}`)
  }
  return lockfile.packages
}

export function lockPathCandidates(name) {
  return [`apps/app/node_modules/${name}`, `node_modules/${name}`]
}

export function lockedVersionForPackage(packages, name) {
  for (const lockPath of lockPathCandidates(name)) {
    const version = packages[lockPath]?.version
    if (typeof version === 'string' && version) return version
  }
  throw new Error(`Community snapshot needs a locked version for ${name}`)
}

export function pinExactLockfileVersions(ranges, packages) {
  return Object.fromEntries(
    Object.entries(ranges)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, range]) => {
        const version = lockedVersionForPackage(packages, name)
        const alias = String(range).match(/^npm:((?:@[^/]+\/)?[^@]+)@/)
        return [name, alias ? `npm:${alias[1]}@${version}` : version]
      }),
  )
}

export function isExactVersion(version) {
  return exactVersionNumber(version) !== null
}

function exactVersionNumber(version) {
  return String(version).match(/^(?:npm:(?:@[^/]+\/)?[^@]+@)?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/)?.[1] ?? null
}

export function assertExactDependencyVersions(dependencies, label) {
  const ranged = Object.entries(dependencies).filter(([, version]) => !isExactVersion(version))
  if (ranged.length === 0) return
  throw new Error(
    `${label} must use exact lockfile versions, not ranges: ${ranged
      .map(([name, version]) => `${name}@${version}`)
      .join(', ')}`,
  )
}

export function communityNpmOverrides(packages, pinnedDirect) {
  const overrides = { ...pinnedDirect }
  for (const name of ['react', 'react-dom']) {
    overrides[name] = lockedVersionForPackage(packages, name)
  }
  // Preserve the private install's security fixes in the standalone snapshot.
  // In particular, the SVG compatibility runtime otherwise reinstalls canvas 2's
  // obsolete binary downloader and vulnerable tar dependency.
  for (const name of ['canvas', 'postcss-selector-parser']) {
    if (lockPathCandidates(name).some((lockPath) => packages[lockPath])) {
      overrides[name] = lockedVersionForPackage(packages, name)
    }
  }
  return Object.fromEntries(Object.entries(overrides).sort(([left], [right]) => left.localeCompare(right)))
}

export function parseLeadingVersion(rangeOrVersion) {
  const match = String(rangeOrVersion).match(/(\d+)\.(\d+)/)
  if (!match) return null
  return { major: Number(match[1]), minor: Number(match[2]) }
}

export function versionSatisfiesPeerRange(installedVersion, peerRange) {
  if (!peerRange) return true
  const installed = parseLeadingVersion(installedVersion)
  if (!installed) return true
  return String(peerRange)
    .split('||')
    .map((range) => range.trim())
    .some((range) => {
      if (!range) return true
      const peer = parseLeadingVersion(range)
      if (!peer) return true
      const floorOnly = range.startsWith('>=') || range.startsWith('>')
      if (floorOnly) {
        if (installed.major !== peer.major) return installed.major > peer.major
        return installed.minor >= peer.minor
      }
      return installed.major === peer.major && installed.minor >= peer.minor
    })
}

export function stagedDirectVersion(packages, name) {
  for (const lockPath of lockPathCandidates(name)) {
    const version = packages[lockPath]?.version
    if (typeof version === 'string' && version) return version
  }
  return null
}

export function assertStagedDirectDependenciesMatchLockfile({
  canonicalPackages,
  stagedPackages,
  dependencyNames,
}) {
  const mismatches = []
  for (const name of dependencyNames) {
    const expected = lockedVersionForPackage(canonicalPackages, name)
    const actual = stagedDirectVersion(stagedPackages, name)
    if (actual !== expected) {
      mismatches.push(`${name}: staged ${actual ?? 'missing'} !== lockfile ${expected}`)
    }
  }
  if (mismatches.length === 0) return
  throw new Error(
    `Community lockfile resolved different versions than the private lockfile:\n${mismatches.join('\n')}`,
  )
}

function readInstalledPackage(cwd, name) {
  const candidates = [
    path.join(cwd, 'apps/app/node_modules', name, 'package.json'),
    path.join(cwd, 'node_modules', name, 'package.json'),
  ]
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue
    return JSON.parse(fs.readFileSync(candidate, 'utf8'))
  }
  throw new Error(`Could not resolve ${name} from ${cwd}`)
}

export function assertInstalledDirectDependencyPeers(
  cwd = process.cwd(),
  { requireExactDeclaredVersions = false } = {},
) {
  const appPackagePath = path.join(cwd, 'apps/app/package.json')
  const fromPackageJson = fs.existsSync(appPackagePath) ? appPackagePath : path.join(cwd, 'package.json')
  if (!fs.existsSync(fromPackageJson)) {
    throw new Error(`Could not find a package.json to resolve Community dependencies from ${cwd}`)
  }

  const appPackage = JSON.parse(fs.readFileSync(fromPackageJson, 'utf8'))
  const declared = {
    ...(appPackage.dependencies ?? {}),
    ...(appPackage.devDependencies ?? {}),
  }
  if (requireExactDeclaredVersions) {
    assertExactDependencyVersions(declared, path.relative(cwd, fromPackageJson) || 'package.json')
  }

  const installedReact = readInstalledPackage(cwd, 'react')
  const installedReactDom = readInstalledPackage(cwd, 'react-dom')
  const peerPackages = { react: installedReact, 'react-dom': installedReactDom }
  const failures = []

  for (const [name, declaredVersion] of Object.entries(declared)) {
    let pkg
    try {
      pkg = readInstalledPackage(cwd, name)
    } catch (error) {
      failures.push(`${error instanceof Error ? error.message : error}`)
      continue
    }
    if (isExactVersion(declaredVersion) && pkg.version !== exactVersionNumber(declaredVersion)) {
      failures.push(`${name}: installed ${pkg.version} !== declared ${declaredVersion}`)
    }
    for (const [peerName, installedPeer] of Object.entries(peerPackages)) {
      const peerRange = pkg.peerDependencies?.[peerName]
      if (!peerRange) continue
      if (!versionSatisfiesPeerRange(installedPeer.version, peerRange)) {
        failures.push(
          `${name}@${pkg.version} requires ${peerName} ${peerRange}, but this install has ${installedPeer.version}`,
        )
      }
    }
  }

  if (failures.length > 0) {
    throw new Error(`Community dependency compatibility check failed:\n${failures.join('\n')}`)
  }

  console.log(
    `Community dependencies match ${requireExactDeclaredVersions ? 'exact pins and ' : ''}React ${installedReact.version} / React DOM ${installedReactDom.version} peers.`,
  )
}
