import { Elysia } from '../src'

import { describe, expect, it } from 'bun:test'
import { req } from './utils'

describe('After Handle', () => {
	it('Ensure mapEarlyResponse is called', async () => {
		const app = new Elysia()
			.onAfterHandle(() => Bun.file('./package.json'))
			.get('/', () => 'NOOP')

		const res = await app.handle(req('/'))

		expect(res instanceof Blob).toBeFalse()
		expect(res instanceof Response).toBeTrue()
	})
})
