/**
 * Canonical JSON serialization — the foundation of content addressing.
 *
 * Spec: spec/package-contract.md "content digest" identity; the exact rules
 * are refined additively in the PL-002 refinements section of that spec.
 *
 * Deterministic serialization rules:
 *
 * 1. Permitted values: `null`, booleans, finite numbers, strings, dense
 *    arrays and plain objects (prototype `Object.prototype` or `null`).
 *    Rejected: `undefined`, functions, symbols, bigints, `NaN`, `Infinity`,
 *    `-0`, non-plain objects (`Map`, `Set`, `Date`, class instances, ...),
 *    sparse arrays and cyclic structures.
 * 2. Object keys are sorted ascending by UTF-16 code unit order.
 * 3. No insignificant whitespace; `{"a":1,"b":2}` style separators.
 * 4. Strings use ECMAScript `JSON.stringify` escaping (well-formed since
 *    ES2019: lone surrogates are escaped).
 * 5. Numbers use the ECMAScript `JSON.stringify` shortest round-trip form.
 * 6. Array element order is preserved.
 *
 * These rules make the serialization a pure function of the VALUE, not of
 * key insertion order (E9: canonicalization stability).
 */

/** Maximum nesting depth accepted before rejection. */
const MAX_DEPTH = 1024

/** Error thrown when a value cannot be canonically serialized. */
export class CanonicalJsonError extends Error {
  /** The path of the offending value within the document. */
  readonly path: string

  constructor(message: string, path: string) {
    super(`${message} at ${path}`)
    this.name = 'CanonicalJsonError'
    this.path = path
  }
}

/** Serializes a JSON-safe value to its canonical form. */
export function canonicalJson(value: unknown): string {
  return serialize(value, new Set<object>(), '$', 0)
}

function serialize(
  value: unknown,
  ancestors: Set<object>,
  path: string,
  depth: number,
): string {
  if (depth > MAX_DEPTH) {
    throw new CanonicalJsonError('exceeded maximum nesting depth', path)
  }
  if (value === null) {
    return 'null'
  }
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false'
    case 'number':
      return serializeNumber(value, path)
    case 'string':
      return JSON.stringify(value)
    case 'bigint':
      throw new CanonicalJsonError('bigint is not canonicalizable', path)
    case 'symbol':
      throw new CanonicalJsonError('symbol is not canonicalizable', path)
    case 'function':
      throw new CanonicalJsonError('function is not canonicalizable', path)
    case 'undefined':
      throw new CanonicalJsonError('undefined is not canonicalizable', path)
    case 'object':
      return serializeObject(value, ancestors, path, depth)
    default:
      throw new CanonicalJsonError('unsupported value type', path)
  }
}

function serializeNumber(value: number, path: string): string {
  if (!Number.isFinite(value)) {
    throw new CanonicalJsonError('non-finite numbers are not canonicalizable', path)
  }
  if (Object.is(value, -0)) {
    throw new CanonicalJsonError('negative zero is not canonicalizable', path)
  }
  return JSON.stringify(value)
}

function serializeObject(
  value: object,
  ancestors: Set<object>,
  path: string,
  depth: number,
): string {
  if (ancestors.has(value)) {
    throw new CanonicalJsonError('cyclic structure', path)
  }
  if (Array.isArray(value)) {
    ancestors.add(value)
    const parts: string[] = []
    for (let index = 0; index < value.length; index += 1) {
      const element = value[index] // holes read as undefined and are rejected
      parts.push(serialize(element, ancestors, `${path}[${index}]`, depth + 1))
    }
    ancestors.delete(value)
    return `[${parts.join(',')}]`
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new CanonicalJsonError('non-plain object', path)
  }
  ancestors.add(value)
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  const parts: string[] = []
  for (const key of keys) {
    parts.push(`${JSON.stringify(key)}:${serialize(record[key], ancestors, `${path}.${key}`, depth + 1)}`)
  }
  ancestors.delete(value)
  return `{${parts.join(',')}}`
}
