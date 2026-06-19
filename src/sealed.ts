/**
 * Build-time seal flag: `globalThis.__ELYSIA_SEALED__`.
 *
 * The AOT build plugin injects it via the bundler's `define`
 * (`{ 'globalThis.__ELYSIA_SEALED__': 'true' }`) once it has proven TOTAL freeze
 * coverage (every validator frozen, every default baked, every custom error
 * captured) on a closed-world app. The bundler then folds the seal guards and
 * DCEs the JIT / `Default` / `Errors` / exact-mirror fallback branches, dropping
 * those imports from the shipped bundle.
 *
 * Two guard shapes are used, both of which let the bundler drop the imported
 * MODULE (not just the call) — `if (true) return` only DCEs the call, esbuild
 * still retains the module from the pre-DCE reference graph:
 *
 *   // wrap the fallback so it becomes `if (false) { … }`
 *   if (!globalThis.__ELYSIA_SEALED__ && …) { …createMirror… }
 *   // or a ternary so the call sits in a dead arm
 *   return globalThis.__ELYSIA_SEALED__ ? undefined : createMirror(…)
 *
 * `globalThis.__ELYSIA_SEALED__` is read (not a bare identifier) so it is
 * undefined-safe everywhere — incl. Cloudflare, where a bare undeclared global
 * read throws. Absent → the guards keep the fallbacks (non-sealed default).
 *
 * A sealed manifest MISS has no fallback — it fails loud rather than silently
 * JIT-compiling (which `EvalError`s on CF anyway).
 */
declare global {
	// eslint-disable-next-line no-var
	var __ELYSIA_SEALED__: boolean | undefined
}

export {}
