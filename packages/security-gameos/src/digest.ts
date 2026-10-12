/**
 * PURE DIGEST HELPERS (PL-041) — SHA-256, byte-stable canonical JSON and
 * digest slugs, mirroring the platform-integrity/platform-economy
 * precedent (node:crypto for hashing only — that is not IO).
 *
 * Every identifier this package mints is content-derived (E9): the same
 * lattice content always produces the same ids, on every machine.
 */

import { createHash } from "node:crypto";

/** Lowercase hex SHA-256 of the UTF-8 bytes of `text`. */
export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Byte-stable canonical JSON (the sibling-services rule): object keys
 * sorted lexicographically, no insignificant whitespace, `JSON.stringify`
 * for scalars. The result is what every digest in this package hashes.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key] === undefined ? null : record[key])}`)
    .join(",")}}`;
}

/** The bare-hex digest of `value`'s canonical JSON form. */
export function digestOf(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

/** A lowercase id slug derived from `value`'s canonical digest. */
export function digestSlug(value: unknown, prefix: string, length = 40): string {
  return `${prefix}-${digestOf(value).slice(0, length)}`;
}
