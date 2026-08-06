import { describe, expect, it } from 'bun:test'

import { Elysia } from '../../src'

const json = { name: 'saltyaom', age: 21 }
const body = JSON.stringify(json)

describe('schema-less body presence gate', () => {
	const app = new Elysia().post('/json', ({ body }) => body ?? 'EMPTY')

	it('parses a body framed by Content-Length', async () => {
		const res = await app.handle(
			new Request('http://e.ly/json', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'content-length': String(body.length)
				},
				body
			})
		)
		await expect(res.json()).resolves.toEqual(json)
	})

	it('parses a Request body without framing headers', async () => {
		const res = await app.handle(
			new Request('http://e.ly/json', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body
			})
		)
		await expect(res.json()).resolves.toEqual(json)
	})

	it('parses a body framed by Transfer-Encoding', async () => {
		const res = await app.handle(
			new Request('http://e.ly/json', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'transfer-encoding': 'chunked'
				},
				body
			})
		)
		await expect(res.json()).resolves.toEqual(json)
	})

	it('exposes undefined body for Content-Length: 0', async () => {
		const res = await app.handle(
			new Request('http://e.ly/json', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'content-length': '0'
				}
			})
		)
		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('EMPTY')
	})

	it('exposes undefined body when no body is present', async () => {
		const res = await app.handle(
			new Request('http://e.ly/json', {
				method: 'POST',
				headers: { 'content-type': 'application/json' }
			})
		)
		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('EMPTY')
	})
})
