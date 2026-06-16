import { Elysia, file, form, t } from '../../src'

import { describe, expect, it } from 'bun:test'

import { Value } from 'typebox/value'
import { req } from '../utils'

describe('TypeSystem - Form', () => {
	it('Create', () => {
		// `Value.Create` builds from the schema, so it has no `~ely-form`
		// marker (that's added by `form()`, not the type) - an empty object.
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

	it('Check', () => {
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

	it('Integrate', async () => {
		const app = new Elysia()
			.get(
				'/form/:name',
				({ params: { name } }) =>
					form({
						name: name as any
					}),
				{
					response: t.Form({
						name: t.Literal('saltyaom')
					})
				}
			)
			.get(
				'/file',
				() =>
					form({
						teapot: file('example/teapot.webp')
					}),
				{
					response: t.Form({
						teapot: t.File()
					})
				}
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
			({ body }) => ({
				name: body.name,
				isFile: body.file instanceof File,
				// the internal `~ely-form` marker must NOT leak into ctx.body
				keys: Object.keys(body)
			}),
			{
				body: t.Form({
					name: t.String(),
					file: t.File()
				})
			}
		)

		const fd = new FormData()
		fd.append('name', 'saltyaom')
		fd.append('file', new Blob(['hi'], { type: 'text/plain' }), 'a.txt')

		const res = await app.handle(req('/', { method: 'POST', body: fd }))
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({
			name: 'saltyaom',
			isFile: true,
			keys: ['name', 'file']
		})
	})

	it('rejects a multipart request body missing a field', async () => {
		const app = new Elysia().post('/', ({ body }) => body, {
			body: t.Form({
				name: t.String(),
				file: t.File()
			})
		})

		const fd = new FormData()
		fd.append('name', 'saltyaom') // missing `file`

		const res = await app.handle(req('/', { method: 'POST', body: fd }))
		expect(res.status).toBe(422)
	})
})
