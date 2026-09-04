import { describe, expect, it } from 'bun:test'

import { cloneHook, mergeHook } from '../../src/utils'

describe('cloneHook collection isolation', () => {
	it('copies the schemas array', () => {
		const local = { schemas: [{ body: { type: 'string' } }] as any }
		const cloned = cloneHook(local)

		expect(cloned.schemas).not.toBe(local.schemas)
		expect(cloned.schemas).toEqual(local.schemas)
	})

	it('copies the derive array', () => {
		const fn = () => ({})
		const local = { derive: [fn] as any }
		const cloned = cloneHook(local)

		expect((cloned as any).derive).not.toBe((local as any).derive)
		expect((cloned as any).derive).toEqual((local as any).derive)
	})

	it('isolates the source schemas from subsequent merges', () => {
		const local = { schemas: [{ body: { type: 'string' } }] as any }
		const appHook = { schemas: [{ query: { type: 'string' } }] as any }

		mergeHook(cloneHook(local), appHook)
		mergeHook(cloneHook(local), appHook)

		expect(local.schemas).toHaveLength(1)
	})
})
