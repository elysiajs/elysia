import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { OVERRIDE_MAP } from '../../src/plugin/aot/core'

// OVERRIDE_MAP feeds generateVirtualType: the sealed/wired virtual
// `elysia/type` module is generated from it. If src/type/exports.ts gains,
// drops or renames a t.* leaf export without OVERRIDE_MAP following, the
// virtual module silently serves the plain typebox member (or omits the
// override entirely) and sealed bundles diverge from the real `elysia/type`.
// This pins the two hand-maintained registries to each other.
describe('AOT OVERRIDE_MAP drift', () => {
	it('matches the t.* leaf re-exports in src/type/exports.ts', () => {
		const source = readFileSync(
			join(import.meta.dir, '../../src/type/exports.ts'),
			'utf8'
		)

		// `export { X } from './elysia/leaf'` and the `X as Y` rename form
		const exportRe =
			/export \{ ([A-Za-z_$][\w$]*)(?: as ([A-Za-z_$][\w$]*))? \} from '\.\/elysia\/([^']+)'/g

		const fromExports: Record<string, { leaf: string; export: string }> = {}
		let match: RegExpExecArray | null
		while ((match = exportRe.exec(source)))
			fromExports[match[2] ?? match[1]] = {
				leaf: match[3],
				export: match[1]
			}

		expect(Object.keys(fromExports).length).toBeGreaterThan(0)
		expect(OVERRIDE_MAP).toEqual(fromExports)
	})
})
