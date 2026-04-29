import { describe, expect, it } from 'bun:test'
import { Elysia } from '../../../src/2'

describe('macro order', () => {
	it('run in order', async () => {
		const order: string[] = []
		let derived

		const app = new Elysia()
			.macro({
				a: {
					beforeHandle: function a() {
						order.push('a')
					}
				},
				b: {
					derive: function derive() {
						order.push('derive')

						return { a: 'ok' }
					},
					beforeHandle: function b({ a }) {
						order.push('b')

						derived = a
					}
				}
			})
			.guard({
				a: true,
				beforeHandle: function a1() {
					order.push('a1')
				}
			})
			.get('/a', () => 'ok')
			.guard({
				b: true,
				beforeHandle: function b1() {
					order.push('b1')
				}
			})
			.get('/b', () => 'ok')

		await app.handle('/b')
		expect(order).toEqual(['derive', 'a', 'a1', 'b', 'b1'])
	})
})
