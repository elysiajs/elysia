import { describe, it, expect } from 'bun:test'
import * as typebox from 'typebox/type'

import { OVERRIDE_MAP, generateVirtualType } from '../../src/plugin/aot/core'
import { t } from '../../src/type'

/** The virtual type module must expose every TypeBox and Elysia `t` member once. */
describe('virtual type export coverage', () => {
	const mappingKeys = Object.keys(OVERRIDE_MAP)
	const typeboxKeys = new Set(Object.keys(typebox))
	const tRecord = t as unknown as Record<string, unknown>
	const typeboxRecord = typebox as unknown as Record<string, unknown>

	it('maps every Elysia-only t export', () => {
		const additions = mappingKeys.filter((k) => !typeboxKeys.has(k)).sort()
		const tAdditions = Object.keys(t)
			.filter((k) => !typeboxKeys.has(k))
			.sort()

		expect(additions).toEqual(tAdditions)
	})

	it('every mapped override differs from its TypeBox original', () => {
		const collisions = mappingKeys.filter((k) => typeboxKeys.has(k))

		for (const k of collisions)
			expect(tRecord[k]).not.toBe(typeboxRecord[k])
	})

	it('contains every TypeBox override in the mapping', () => {
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
			const mod = (await import(
				`../../src/type/elysia/${leaf}`
			)) as Record<string, unknown>
			expect(mod[exported], `${name} → ${leaf}.${exported}`).toBeDefined()
		}
	})

	it('generated virtual module is a pure re-export surface (no setupTypebox)', async () => {
		const src = await generateVirtualType('elysia/type')

		const exportLines = src
			.split('\n')
			.filter((l) => l.startsWith('export'))
		expect(exportLines.length).toBe(mappingKeys.length + 1)

		expect(src).not.toMatch(/setupTypebox/)
		expect(src).not.toMatch(/\/compat/)
		expect(src).not.toMatch(/from ['"]elysia['"]/)
	})
})
