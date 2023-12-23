import { Elysia } from '../../src'

import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

describe('After Handle', () => {
	it('work global', async () => {
		const app = new Elysia().onAfterHandle(() => 'A').get('/', () => 'NOOP')

		const res = await app.handle(req('/')).then((x) => x.text())

		expect(res).toBe('A')
	})

	it('work local', async () => {
		const app = new Elysia().get('/', () => 'NOOP', {
			afterHandle() {
				return 'A'
			}
		})

		const res = await app.handle(req('/')).then((x) => x.text())

		expect(res).toBe('A')
	})

	it('accept response', async () => {
		const app = new Elysia().get('/', () => 'NOOP', {
			afterHandle({ response }) {
				return response
			}
		})

		const res = await app.handle(req('/')).then((x) => x.text())

		expect(res).toBe('NOOP')
	})
})
