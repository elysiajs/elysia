import { describe, expect, it } from 'bun:test'

import { Elysia } from '../../src'

describe('extension overrides', () => {
	it('replaces a primitive decorator with an object', () => {
		const app = new Elysia()
			.decorate('config', 'legacy')
			.decorate('override', 'config', { mode: 'prod' } as any)

		expect((app as any)['~ext'].decorator.config).toEqual({ mode: 'prod' })
	})

	it('replaces primitive state with an object', () => {
		const app = new Elysia()
			.state('config', 1)
			.state('override', 'config', { mode: 'prod' } as any)

		expect((app as any)['~ext'].store.config).toEqual({ mode: 'prod' })
	})

	it('merges two plain-object decorators', () => {
		const app = new Elysia()
			.decorate('config', { a: 1, b: 2 } as any)
			.decorate('override', 'config', { b: 3, c: 4 } as any)

		expect((app as any)['~ext'].decorator.config).toEqual({
			a: 1,
			b: 3,
			c: 4
		})
	})
})
