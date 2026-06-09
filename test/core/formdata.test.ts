import { Elysia, t, form, file } from '../../src'
import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

describe('Form Data', () => {
	it('return Bun.file', async () => {
		const app = new Elysia().get('/', () =>
			form({
				a: 'hello',
				b: Bun.file('test/kyuukurarin.mp4')
			})
		)

		const contentType = await app
			.handle(req('/'))
			.then((x) => x.headers.get('content-type'))

		expect(contentType).toStartWith('multipart/form-data')
	})

	it('return Elysia.file', async () => {
		const app = new Elysia().get('/', () =>
			form({
				a: 'hello',
				b: file('test/kyuukurarin.mp4')
			})
		)

		const contentType = await app
			.handle(req('/'))
			.then((x) => x.headers.get('content-type'))

		expect(contentType).toStartWith('multipart/form-data')
	})

	it('return Elysia.file', async () => {
		const app = new Elysia().get('/', () =>
			form({
				a: 'hello',
				b: file('test/kyuukurarin.mp4')
			})
		)

		const contentType = await app
			.handle(req('/'))
			.then((x) => x.headers.get('content-type'))

		expect(contentType).toStartWith('multipart/form-data')
	})

	it('validate formdata', async () => {
		const app = new Elysia().get(
			'/',
			() =>
				form({
					a: 'hello',
					b: file('test/kyuukurarin.mp4')
				}),
			{
				response: t.Form({
					a: t.String(),
					b: t.File()
				})
			}
		)

		const response = await app.handle(req('/'))

		expect(response.status).toBe(200)
		expect(response.headers.get('content-type')).toStartWith(
			'multipart/form-data'
		)
	})

	it('return single file', async () => {
		const app = new Elysia().get('/', () => file('test/kyuukurarin.mp4'))

		const response = await app.handle(req('/'))

		expect(response.status).toBe(200)
		expect(response.headers.get('content-type')).toStartWith('video/mp4')
	})

	it('inline single file', async () => {
		const app = new Elysia().get('/', file('test/kyuukurarin.mp4'))

		const response = await app.handle(req('/'))

		expect(response.status).toBe(200)
		expect(response.headers.get('content-type')).toStartWith('video/mp4')
	})
})
