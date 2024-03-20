import { describe, it, expect } from 'bun:test'
import { Elysia } from '../../src'
import { req } from '../utils'

describe('Propagate', () => {
	it('works', async () => {
		const subPlugin1 = new Elysia().derive({ as: 'scoped' }, () => {
			return {
				hi: 'hi'
			}
		})

		const subPlugin2 = new Elysia().derive({ as: 'scoped' }, () => {
			return {
				none: 'none'
			}
		})

		const plugin = new Elysia().use(subPlugin1).propagate().use(subPlugin2)

		plugin._volatile

		const app = new Elysia()
			.use(plugin)
			// @ts-expect-error
			.get('/', ({ hi, none }) => none ?? hi)

		const res = await app.handle(req('/')).then((x) => x.text())

		expect(res).toBe('hi')
	})
})
