import { Elysia, file, form, t } from '../../src'

import { describe, expect, it } from 'bun:test'

import { Value } from 'typebox/value'
import { req } from '../utils'

describe('TypeSystem - Form', () => {
	it('creates an empty form unless a default is provided', () => {
		expect(Value.Create(t.Form({}))).toEqual({} as any)

		expect(
			Value.Create(
				t.Form(
					{},
					{
						default: form({
							name: 'saltyaom'
						})
					}
				)
			)
		).toEqual(
			form({
				name: 'saltyaom'
			})
		)
	})

	it('validates form fields', () => {
		const schema = t.Form({
			name: t.String(),
			age: t.Number()
		})

		expect(
			Value.Check(
				schema,
				form({
					name: 'saltyaom',
					age: 20
				})
			)
		).toBe(true)

		try {
			Value.Check(
				schema,
				form({
					name: 'saltyaom'
				})
			)
			expect(true).toBe(false)
		} catch {
			expect(true).toBe(true)
		}
	})

	it('validates form responses', async () => {
		const app = new Elysia()
			.get(
				'/form/:name',
				{
					response: t.Form({
						name: t.Literal('saltyaom')
					})
				},
				({ params: { name } }) =>
					form({
						name: name as any
					})
			)
			.get(
				'/file',
				{
					response: t.Form({
						teapot: t.File()
					})
				},
				() =>
					form({
						teapot: file('example/teapot.webp')
					})
			)

		const res1 = await app.handle(req('/form/saltyaom'))
		expect(res1.status).toBe(200)

		const res2 = await app.handle(req('/form/felis'))
		expect(res2.status).toBe(422)

		const res3 = await app.handle(req('/file'))
		expect(res3.status).toBe(200)
	})

	it('accepts a multipart request body and exposes the parsed fields', async () => {
		const app = new Elysia().post(
			'/',
			{
				body: t.Form({
					name: t.String(),
					file: t.File()
				})
			},
			({ body }) => ({
				name: body.name,
				isFile: body.file instanceof File,
				keys: Object.keys(body)
			})
		)

		const fd = new FormData()
		fd.append('name', 'saltyaom')
		fd.append('file', new Blob(['hi'], { type: 'text/plain' }), 'a.txt')

		const res = await app.handle(req('/', { method: 'POST', body: fd }))
		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual({
			name: 'saltyaom',
			isFile: true,
			keys: ['name', 'file']
		})
	})

	it('rejects a multipart request body missing a field', async () => {
		const app = new Elysia().post(
			'/',
			{
				body: t.Form({
					name: t.String(),
					file: t.File()
				})
			},
			({ body }) => body
		)

		const fd = new FormData()
		fd.append('name', 'saltyaom')

		const res = await app.handle(req('/', { method: 'POST', body: fd }))
		expect(res.status).toBe(422)
	})
})
