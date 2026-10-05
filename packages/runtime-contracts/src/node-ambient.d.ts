/**
 * Minimal ambient declarations for the Node built-in test modules used by
 * the colocated tests.
 *
 * Why local: this package ships with ZERO dependencies and the repository
 * lockfile is TL-owned (no root install is performed by workers), so
 * `@types/node` is not resolvable here. tsconfig sets `"types": []` so no
 * ambient @types packages are auto-included; these declarations are the
 * only typing for `node:test` / `node:assert/strict` in this program.
 *
 * They cover ONLY what this package's tests use. At graft time the TL may
 * replace them with `@types/node` if the toolchain provides it; the test
 * code itself needs no changes (the imported API surface is identical).
 */

declare module "node:test" {
  export function test(
    name: string,
    fn: () => void | Promise<unknown>,
  ): void;
  export function test(
    options: { readonly name: string; readonly only?: boolean; readonly skip?: boolean },
    fn: () => void | Promise<unknown>,
  ): void;
}

declare module "node:assert/strict" {
  export function ok(value: unknown, message?: string): void;
  export function equal(actual: unknown, expected: unknown, message?: string): void;
  export function notEqual(actual: unknown, expected: unknown, message?: string): void;
  export function deepEqual(actual: unknown, expected: unknown, message?: string): void;
  export function throws(block: () => unknown, message?: string): void;
}

/** Minimal console declaration (used by harness.ts only). */
declare const console: {
  log(...data: readonly unknown[]): void;
};
