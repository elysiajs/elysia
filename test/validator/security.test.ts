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

	it('handle arbitrary code execution from params default', async () => {
		const app = new Elysia().get(
			'/:id',
			// @ts-ignore
			(c) => c.q ?? 'safe',
			{
				params: t.Object({
					id: t.String(),
					filter: t.String({
						default: `';console.log(c.q='pwn');'`
					})
				})
			}
		)

		const response = await app.handle(req('/abc')).then((x) => x.text())

		expect(response).toBe('safe')
	})

	it('handle arbitrary code execution from body string default', async () => {
		const app = new Elysia().post(
			'/',
			// @ts-ignore
			(c) => c.q ?? 'safe',
			{
				body: t.String({
					default: `';console.log(c.q='pwn');'`
				})
			}
		)

		const response = await app
			.handle(new Request('http://localhost/', { method: 'POST' }))
			.then((x) => x.text())

		expect(response).toBe('safe')
	})

	it('handle arbitrary code execution from body object default value', async () => {
		const app = new Elysia().post(
			'/',
			// @ts-ignore
			(c) => c.q ?? 'safe',
			{
				body: t.Object({
					field: t.String({
						default: `';console.log(c.q='pwn');'`
					})
				})
			}
		)

		const response = await app
			.handle(
				new Request('http://localhost/', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({})
				})
			)
			.then((x) => x.text())

		expect(response).toBe('safe')
	})
})
