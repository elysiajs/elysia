import { describe, it, expect } from 'bun:test'
import * as typebox from 'typebox/type'

import { OVERRIDE_MAP, generateVirtualType } from '../../src/plugin/core'
import { t } from '../../src/type'

/**
 * The AOT plugin's virtual `elysia/type` re-exports TypeBox's `t.*` names for
 * everything EXCEPT the 27 Elysia overrides, which it re-routes to leaf modules.
 * `OVERRIDE_MAP` is that hand-maintained list. If a future `t.*` addition or
 * removal skips the table, the virtual module would either drop a real `t.*`
 * member or double-declare a name — this pins the table against the live `t`
 * object so such drift trips loudly.
 *
 * The model (verified): `Object.keys(t)` = `Object.keys(typebox)` MINUS any
 * name-collision overrides (which keep the same key but a different value) PLUS
 * the pure additions Elysia introduces. So:
 *   - additions (mapping keys not in typebox) === keys(t) \ keys(typebox)
 *   - the collision overrides (mapping keys IN typebox) all have t[k] !== tb[k]
 *   - no typebox key is overridden by `t` outside the mapping
 */
describe('virtual-type override drift', () => {
	const mappingKeys = Object.keys(OVERRIDE_MAP)
	const typeboxKeys = new Set(Object.keys(typebox))
	const tRecord = t as unknown as Record<string, unknown>
	const typeboxRecord = typebox as unknown as Record<string, unknown>

	it('mapping additions === keys in t but not in typebox', () => {
		const additions = mappingKeys
			.filter((k) => !typeboxKeys.has(k))
			.sort()
		const tAdditions = Object.keys(t)
			.filter((k) => !typeboxKeys.has(k))
			.sort()

		expect(additions).toEqual(tAdditions)
	})

	it('every name-collision override actually differs from typebox', () => {
		const collisions = mappingKeys.filter((k) => typeboxKeys.has(k))

		for (const k of collisions)
			expect(tRecord[k]).not.toBe(typeboxRecord[k])
	})

	it('no typebox name is overridden by t outside the mapping', () => {
		const mappingSet = new Set(mappingKeys)
		const drifted = [...typeboxKeys].filter(
			(k) =>
				tRecord[k] !== undefined &&
				tRecord[k] !== typeboxRecord[k] &&
				!mappingSet.has(k)
		)

		expect(drifted).toEqual([])
	})

	it('every mapped export exists in its leaf module', async () => {
		for (const [name, { leaf, export: exported }] of Object.entries(
			OVERRIDE_MAP
		)) {
			const mod = (await import(`../../src/type/elysia/${leaf}`)) as Record<
				string,
				unknown
			>
			expect(
				mod[exported],
				`${name} → ${leaf}.${exported}`
			).toBeDefined()
		}
	})

	it('generated virtual module is a pure re-export surface (no setupTypebox)', async () => {
		const src = await generateVirtualType('elysia/type')

		// One typebox passthrough line + one per override.
		const exportLines = src
			.split('\n')
			.filter((l) => l.startsWith('export'))
		expect(exportLines.length).toBe(mappingKeys.length + 1)

		// The whole point: consuming `t` this way must NOT drag the bridge latch.
		expect(src).not.toMatch(/setupTypebox/)
		expect(src).not.toMatch(/\/compat/)
		expect(src).not.toMatch(/from ['"]elysia['"]/)
	})
})
