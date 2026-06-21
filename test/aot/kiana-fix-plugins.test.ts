import { describe, it, expect } from 'bun:test'

import { rewriteTypeImport } from '../../src/plugin/treeshake'
import { aot as viteAot } from '../../src/plugin/vite'

/**
 * Regression tests for kiana build-plugin fixes.
 *
 * idx27/28 — the treeshake `from` (where USER source imports `t`) was wrongly
 *   set to `registerFrom` (where the MANIFEST imports `Compiled`). A custom
 *   `registerFrom` therefore silently disabled the headline tree-shake.
 * idx43 — the import-rewrite regex stopped at the specifier quote and orphaned a
 *   trailing import-attributes clause (`with {...}` / `assert {...}`) onto the
 *   wrong rewritten line.
 */

describe('kiana plugin fixes', () => {
	describe('idx27/28 — registerFrom must not disable tree-shaking', () => {
		// WHY: `registerFrom` is the Compiled-import path of the generated manifest,
		// a DIFFERENT concept from the specifier the user writes `import { t } from`.
		// They only coincide when both are unset (default 'elysia'). A monorepo /
		// pnpm / aliased install sets `registerFrom` to a custom path; if that value
		// is passed as the treeshake `from`, the rewrite regex searches user code for
		// `import { t } from '<registerFrom>'`, never matches the real
		// `import { t } from 'elysia'`, and the bundle-size optimization is a silent
		// no-op. The fix decouples them: the rewrite always targets 'elysia'.
		it('vite transform still rewrites t when registerFrom is custom', () => {
			const plugin = viteAot('src/index.ts', {
				registerFrom: './elysia-wrapper'
			})

			const out = plugin.transform(
				`import { Elysia, t } from 'elysia'\nt.Object({ a: t.String() })`,
				'/project/src/handlers.ts'
			)

			// the rewrite MUST have happened despite the custom registerFrom —
			// with the bug this returned `undefined` (code unchanged, no shake)
			expect(out).toBeDefined()
			expect(out).toContain(`import * as t from 'elysia/type'`)
			expect(out).toContain(`import { Elysia } from 'elysia'`)
			// call site is untouched — that is the whole point of the rewrite
			expect(out).toContain('t.Object({ a: t.String() })')
		})

		it('the underlying rewrite is keyed on the t-import specifier, not registerFrom', () => {
			// Passing a registerFrom-style path as `from` is exactly the old bug: the
			// user imports from 'elysia', so a non-'elysia' `from` matches nothing and
			// leaves the un-shakeable barrel import in place. This documents WHY the
			// plugins must default `from` to 'elysia' rather than forward registerFrom.
			const userCode = `import { t } from 'elysia'\nt.Number()`
			expect(
				rewriteTypeImport(userCode, {
					from: '/abs/monorepo/src/compile/index.ts'
				})
			).toBe(userCode) // wrong `from` ⇒ no rewrite (the regression)

			// default 'elysia' (what the fixed plugins now use) shakes correctly
			expect(rewriteTypeImport(userCode)).toBe(
				`import * as t from 'elysia/type'\nt.Number()`
			)
		})
	})

	describe('idx43 — import attributes must not be orphaned/mis-attributed', () => {
		// WHY: a `with {...}` / `assert {...}` clause describes the module being
		// imported. The old regex stopped at the closing quote of the specifier, so
		// the attribute survived in place and ended up glued to whatever line the
		// rewrite emitted next — silently mis-applying an attribute meant for the
		// original import to the `elysia/type` namespace redirect, and stripping it
		// from the kept-members line.
		it('keeps a with-attribute on the sole-t namespace line, not orphaned', () => {
			expect(
				rewriteTypeImport(
					`import { t } from 'elysia' with { type: 'macro' }\nt.Number()`
				)
			).toBe(
				`import * as t from 'elysia/type' with { type: 'macro' }\nt.Number()`
			)
		})

		it('preserves a with-attribute on BOTH split imports', () => {
			expect(
				rewriteTypeImport(
					`import { Elysia, t } from 'elysia' with { type: 'json' }\nt.Object()`
				)
			).toBe(
				`import { Elysia } from 'elysia' with { type: 'json' }\n` +
					`import * as t from 'elysia/type' with { type: 'json' }\n` +
					`t.Object()`
			)
		})

		it('handles the legacy `assert` attribute keyword', () => {
			expect(
				rewriteTypeImport(
					`import { t } from 'elysia' assert { type: 'macro' }\nt.X()`
				)
			).toBe(
				`import * as t from 'elysia/type' assert { type: 'macro' }\nt.X()`
			)
		})

		it('does not swallow a trailing semicolon as an attribute', () => {
			// guards the optional attribute group against over-consuming benign
			// trailing tokens that DO occur in real code
			expect(rewriteTypeImport(`import { t } from 'elysia';\nt.X()`)).toBe(
				`import * as t from 'elysia/type';\nt.X()`
			)
		})
	})
})
