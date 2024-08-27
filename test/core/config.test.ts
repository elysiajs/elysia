import { describe, it, expect } from 'bun:test'
import { Elysia, t } from '../../src'

describe('config', () => {
	it('standard hostname', async () => {
		const app = new Elysia({ handler: { standardHostname: false } }).get(
			'/a',
			'a'
		)

		const response = await app
			.handle(new Request('http://a/a'))
			.then((x) => x.text())

		expect(response).toBe('a')
	})
})
