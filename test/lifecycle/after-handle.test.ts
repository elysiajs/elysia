import { Elysia } from '../../src'

import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

describe('After Handle', () => {
	it('ensure mapEarlyResponse is called', async () => {
		const app = new Elysia().onAfterHandle(() => 'A').get('/', () => 'NOOP')

		const res = await app.handle(req('/')).then((x) => x.text())

		expect(res).toBe('A')
	})
})
