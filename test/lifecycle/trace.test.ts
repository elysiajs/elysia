import { Elysia } from '../../src'

import { describe, expect, it } from 'bun:test'

describe('On Trace', () => {
	it('register plugin', () => {
		const a = new Elysia().trace({ as: 'global' }, () => {})

		const app = new Elysia()
			.use(a)
			.use(a)
			.get('/', () => {})

		expect(app.routes[0].hooks.trace.length).toBe(2)
	})

	it('deduplicate plugin on name provided', () => {
		const a = new Elysia({ name: 'a' }).trace({ as: 'global' }, () => {})

		const app = new Elysia()
			.use(a)
			.use(a)
			.get('/', () => {})

		expect(app.routes[0].hooks.trace.length).toBe(1)
	})
})
