/**
 * Opaque revision tokens for project roots. Every committed change produces a new immutable
 * root object, so identity covers unsaved local edits as well as saved ones.
 */
const tokens = new WeakMap<object, string>()
let nextToken = 1

export function projectRevisionToken(project: object): string {
  let token = tokens.get(project)
  if (!token) {
    token = `r${nextToken++}`
    tokens.set(project, token)
  }
  return token
}
