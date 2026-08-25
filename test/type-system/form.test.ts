import { Elysia, file, form, t } from '../../src'
import { isElysiaForm } from '../../src/utils'

import { describe, expect, it } from 'bun:test'

import { Value } from 'typebox/value'

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

		const res1 = await app.handle('/form/saltyaom')
		expect(res1.status).toBe(200)

		const res2 = await app.handle('/form/felis')
		expect(res2.status).toBe(422)

		const res3 = await app.handle('/file')
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

		const res = await app.handle('/', { method: 'POST', body: fd })
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

		const res = await app.handle('/', { method: 'POST', body: fd })
		expect(res.status).toBe(422)
	})
})

describe('TypeSystem - Form marker', () => {
	// What flags an object as a form is its *prototype*, never an own key. That
	// is the entire point: a request body arrives as JSON or as form fields, so
	// a client can send a property *named* `~ely-form`, and can even send an own
	// `constructor: { name: 'ElysiaForm' }` — but nothing a client sends changes
	// `Object.getPrototypeOf(value).constructor.name`. Without this, any handler
	// that echoes user data back (`({ body }) => body`) could be talked into
	// emitting that data as multipart instead of JSON.
	//
	// Matched by constructor *name*, not `instanceof`, so two copies of elysia
	// in one process still recognise each other's forms — the same rule the
	// response mapper's `responseTag` already uses for ElysiaFile/ElysiaStatus.
	it('marks a form out of band, where a client body cannot reach', () => {
		const value = form({ name: 'saltyaom' })

		expect(isElysiaForm(value)).toBe(true)

		// the mark costs no own property: nothing new is enumerable, nothing
		// leaks into JSON.stringify, and no symbol is involved
		expect(Object.keys(value)).toEqual(['name'])
		expect(Object.getOwnPropertySymbols(value)).toEqual([])
		expect(JSON.stringify(value)).toBe('{"name":"saltyaom"}')

		// the two closest things a client can send
		expect(isElysiaForm(JSON.parse('{"name":"x","~ely-form":1}'))).toBe(
			false
		)
		expect(
			isElysiaForm(JSON.parse('{"constructor":{"name":"ElysiaForm"}}'))
		).toBe(false)
	})

	// The cost of an out-of-band marker: any copy of a form is a plain object,
	// because neither spread nor `structuredClone` carries a prototype.
	//
	// Spread is a real behaviour change — an own enumerable marker used to
	// survive `{ ...form(x) }`. It cannot both survive a spread and be
	// unforgeable: spread copies exactly the own enumerable properties that
	// `JSON.parse` produces, so anything a spread preserves is something a
	// client can forge. This is the same trade already accepted for
	// `structuredClone`, and it fails closed (JSON, not multipart).
	it('stops being a form once it is copied', () => {
		const schema = t.Form({ name: t.String() })
		const value = form({ name: 'saltyaom' })

		expect(Value.Check(schema, value)).toBe(true)
		expect(Value.Check(schema, { ...value })).toBe(false)
		expect(Value.Check(schema, structuredClone(value))).toBe(false)
		expect(Value.Check(schema, JSON.parse(JSON.stringify(value)))).toBe(
			false
		)
	})

	// The user-visible half of the above: the response mapper dispatches on the
	// same prototype, so a handler returning a copied form serves JSON. Re-form
	// it with `form({ ...value })` to keep multipart.
	it('serves a copied form as JSON, not multipart', async () => {
		for (const copy of [
			() => ({ ...form({ a: 'b' }) }),
			() => structuredClone(form({ a: 'b' }))
		]) {
			const app = new Elysia().get('/', copy)

			const res = await app.handle('/')
			expect(res.headers.get('content-type')).toStartWith(
				'application/json'
			)
			await expect(res.json()).resolves.toEqual({ a: 'b' })
		}
	})

	// A field literally named `~ely-form` used to collide with the marker, so
	// the multipart serialiser skipped it — the user's own data was silently
	// discarded from the emitted body. A prototype marker owns no key at all,
	// so the field is emitted like any other.
	it('emits a user field named `~ely-form` instead of discarding it', async () => {
		const app = new Elysia().get('/', () =>
			form({ a: 'b', '~ely-form': 'user-data' })
		)

		const res = await app.handle('/')
		expect(res.headers.get('content-type')).toStartWith(
			'multipart/form-data'
		)

		const body = await res.formData()
		expect([...body.entries()]).toEqual([
			['a', 'b'],
			['~ely-form', 'user-data']
		])
	})
})
