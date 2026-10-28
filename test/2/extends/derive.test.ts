import { describe, expect, it } from 'bun:test'
import { Elysia } from '../../../src'

describe('derive', () => {
	it('exposes plugin-scoped values to consumer routes', async () => {
		const a = new Elysia().derive('plugin', () => ({
			a: 'a'
		}))

		const app = new Elysia().use(a).get('/', ({ a }) => a)

		await expect(app.handle('/').then((x) => x.text())).resolves.toBe('a')
	})
})
