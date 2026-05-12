import { Elysia, t } from '../../src'

import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

describe('Validator Security', () => {
	it('handle arbitrary code execution from query default', async () => {
		const app = new Elysia().get(
			'/',
			// @ts-ignore
			(c) => c.q ?? 'safe',
			{
				query: t.Object({
					foo: t.String({
						default: `';console.log(c.q='pwn');'`
					})
				})
			}
		)

		const response = await app.handle(req('/')).then((x) => x.text())

		expect(response).toBe('safe')
	})

	it('handle arbitrary code execution from headers default', async () => {
		const app = new Elysia().get(
			'/',
			// @ts-ignore
			(c) => c.q ?? 'safe',
			{
				headers: t.Object({
					'x-foo': t.String({
						default: `';console.log(c.q='pwn');'`
					})
				})
			}
		)

		const response = await app.handle(req('/')).then((x) => x.text())

		expect(response).toBe('safe')
	})
})
