import { describe, expect, it } from 'bun:test'
import { Elysia } from '../../src'
import { req } from '../utils'

describe('context', () => {
	describe('return route', () => {
		it('on aot=true', async () => {
			const app = new Elysia().get('/hi/:id', ({ route }) => route)
			const res = await app.handle(req('/hi/123')).then((x) => x.text())
			expect(res).toBe('/hi/:id')
		})

		it('on aot=false', async () => {
			const app = new Elysia({ aot: false }).get(
				'/hi/:id',
				({ route }) => route
			)
			const res = await app.handle(req('/hi/123')).then((x) => x.text())
			expect(res).toBe('/hi/:id')
		})
	})

	describe('early return on macros with route data', () => {
		it('on aot=true', async () => {
			const app = new Elysia()
				.macro({
					test: {
						beforeHandle({ route }) {
							return route
						}
					}
				})
				.get('/hi/:id', () => 'should not returned', {
					test: true
				})
			const res = await app.handle(req('/hi/123')).then((x) => x.text())
			expect(res).toBe('/hi/:id')
		})

		it('on aot=false', async () => {
			const app = new Elysia({ aot: false })
				.macro({
					test: {
						beforeHandle({ route }) {
							return route
						}
					}
				})
				.get('/hi/:id', () => 'should not returned', {
					test: true
				})
			const res = await app.handle(req('/hi/123')).then((x) => x.text())
			expect(res).toBe('/hi/:id')
		})
	})
})
