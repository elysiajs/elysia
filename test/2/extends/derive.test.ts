import { describe, expect, it } from 'bun:test'
import { Elysia } from '../../../src/2'

describe('derive', () => {
	it('from plugin', async () => {
		const a = new Elysia().derive({ as: 'scoped' }, () => ({
			a: 'a'
		}))

		const app = new Elysia().use(a).get('/', ({ a }) => a)

		expect(app.handle('/').then((x) => x.text())).resolves.toBe('a')
	})
})
