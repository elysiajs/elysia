import { describe, expect, it } from 'bun:test'
import { Elysia } from '../../../src'

describe('macro hook order', () => {
	it('runs macro and guard hooks in registration order', async () => {
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
					// Sibling macro hooks do not infer derived context.
					beforeHandle: function b({ a }: { a?: string }) {
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
		expect(order).toEqual(['a', 'a1', 'derive', 'b', 'b1'])
	})
})
