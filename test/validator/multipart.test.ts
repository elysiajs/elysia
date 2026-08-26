import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { Elysia, t } from '../../src'

const upload = (form: FormData) =>
	new Request('http://localhost/upload', {
		method: 'POST',
		body: form
	})

describe('Multipart string field', () => {
	it('keep JSON object text as string when field is t.String()', async () => {
		const app = new Elysia().post('/upload', ({ body }) => body.metadata, {
			body: t.Object({
				file: t.File(),
				metadata: t.String()
			}),
			type: 'multipart'
		})

		const metadata = JSON.stringify({ theme: 'dark' })

		const form = new FormData()
		form.append('file', new File(['example'], 'example.txt'))
		form.append('metadata', metadata)

		const response = await app.handle(upload(form))

		expect(response.status).toBe(200)
		expect(await response.text()).toBe(metadata)
	})

	it('keep JSON array text as string when field is t.String()', async () => {
		const app = new Elysia().post('/upload', ({ body }) => body.metadata, {
			body: t.Object({
				metadata: t.String()
			}),
			type: 'multipart'
		})

		const metadata = JSON.stringify([1, 2, 3])

		const form = new FormData()
		form.append('metadata', metadata)

		const response = await app.handle(upload(form))

		expect(response.status).toBe(200)
		expect(await response.text()).toBe(metadata)
	})

	it('keep JSON text as string when field is t.Optional(t.String())', async () => {
		const app = new Elysia().post(
			'/upload',
			({ body }) => body.metadata ?? '',
			{
				body: t.Object({
					metadata: t.Optional(t.String())
				}),
				type: 'multipart'
			}
		)

		const metadata = JSON.stringify({ theme: 'dark' })

		const form = new FormData()
		form.append('metadata', metadata)

		const response = await app.handle(upload(form))

		expect(response.status).toBe(200)
		expect(await response.text()).toBe(metadata)
	})

	it('keep JSON text as string in nested field with dot notation', async () => {
		const app = new Elysia().post('/upload', ({ body }) => body.meta.info, {
			body: t.Object({
				meta: t.Object({
					info: t.String()
				})
			}),
			type: 'multipart'
		})

		const info = JSON.stringify({ nested: true })

		const form = new FormData()
		form.append('meta.info', info)

		const response = await app.handle(upload(form))

		expect(response.status).toBe(200)
		expect(await response.text()).toBe(info)
	})

	it('keep JSON text as string when union accepts both string and object', async () => {
		const app = new Elysia().post(
			'/upload',
			({ body }) => ({
				kind: typeof body.metadata,
				value: body.metadata
			}),
			{
				body: t.Object({
					metadata: t.Union([
						t.String(),
						t.Object({ theme: t.String() })
					])
				}),
				type: 'multipart'
			}
		)

		const metadata = JSON.stringify({ theme: 'dark' })

		const form = new FormData()
		form.append('metadata', metadata)

		const response = await app.handle(upload(form))

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({
			kind: 'string',
			value: metadata
		})
	})

	it('preserve string field while structured field is parsed in the same body', async () => {
		const app = new Elysia().post(
			'/upload',
			({ body }) => ({
				metadata: body.metadata,
				theme: body.settings.theme
			}),
			{
				body: t.Object({
					file: t.File(),
					metadata: t.String(),
					settings: t.Object({
						theme: t.String()
					})
				}),
				type: 'multipart'
			}
		)

		const metadata = JSON.stringify({ keep: 'raw' })

		const form = new FormData()
		form.append('file', new File(['example'], 'example.txt'))
		form.append('metadata', metadata)
		form.append('settings', JSON.stringify({ theme: 'dark' }))

		const response = await app.handle(upload(form))

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({
			metadata,
			theme: 'dark'
		})
	})

	it('keep JSON text as string for standard schema string field', async () => {
		const app = new Elysia().post('/upload', ({ body }) => body.metadata, {
			body: z.object({
				metadata: z.string()
			}),
			type: 'multipart'
		})

		const metadata = JSON.stringify({ theme: 'dark' })

		const form = new FormData()
		form.append('metadata', metadata)

		const response = await app.handle(upload(form))

		expect(response.status).toBe(200)
		expect(await response.text()).toBe(metadata)
	})

	it('keep JSON text as string for optional standard schema string field', async () => {
		const app = new Elysia().post(
			'/upload',
			({ body }) => body.note ?? '',
			{
				body: z.object({
					note: z.string().optional()
				}),
				type: 'multipart'
			}
		)

		const note = JSON.stringify(['a', 'b'])

		const form = new FormData()
		form.append('note', note)

		const response = await app.handle(upload(form))

		expect(response.status).toBe(200)
		expect(await response.text()).toBe(note)
	})

	it('keep JSON text as string when field is t.String() in dynamic mode', async () => {
		const app = new Elysia({ aot: false }).post(
			'/upload',
			({ body }) => body.metadata,
			{
				body: t.Object({
					metadata: t.String()
				})
			}
		)

		const metadata = JSON.stringify({ theme: 'dark' })

		const form = new FormData()
		form.append('metadata', metadata)

		const response = await app.handle(upload(form))

		expect(response.status).toBe(200)
		expect(await response.text()).toBe(metadata)
	})

	it('keep JSON text as string in nested field in dynamic mode', async () => {
		const app = new Elysia({ aot: false }).post(
			'/upload',
			({ body }) => body.meta.info,
			{
				body: t.Object({
					meta: t.Object({
						info: t.String()
					})
				})
			}
		)

		const info = JSON.stringify({ nested: true })

		const form = new FormData()
		form.append('meta.info', info)

		const response = await app.handle(upload(form))

		expect(response.status).toBe(200)
		expect(await response.text()).toBe(info)
	})

	it('reject mismatched structured field and identify that field', async () => {
		const app = new Elysia().post('/upload', ({ body }) => body, {
			body: t.Object({
				metadata: t.String(),
				settings: t.Object({
					theme: t.String()
				})
			}),
			type: 'multipart'
		})

		const form = new FormData()
		form.append('metadata', JSON.stringify({ keep: 'raw' }))
		form.append('settings', JSON.stringify({ wrong: 1 }))

		const response = await app.handle(upload(form))

		expect(response.status).toBe(422)

		const error = (await response.json()) as {
			type: string
			property: string
		}
		expect(error.type).toBe('validation')
		expect(error.property).toContain('settings')
	})

	it('reject mismatched structured field for standard schema and identify that field', async () => {
		const app = new Elysia().post('/upload', ({ body }) => body, {
			body: z.object({
				metadata: z.string(),
				settings: z.object({
					theme: z.string()
				})
			}),
			type: 'multipart'
		})

		const form = new FormData()
		form.append('metadata', JSON.stringify({ keep: 'raw' }))
		form.append('settings', JSON.stringify({ wrong: 1 }))

		const response = await app.handle(upload(form))

		expect(response.status).toBe(422)

		const error = (await response.json()) as {
			type: string
			property: string
		}
		expect(error.type).toBe('validation')
		expect(error.property).toContain('settings')
	})

	it('adopt structured interpretation when the route has no body schema', async () => {
		const app = new Elysia().post('/upload', ({ body }) => ({
			kind: typeof (body as any).metadata,
			value: (body as any).metadata
		}))

		const form = new FormData()
		form.append('metadata', JSON.stringify({ theme: 'dark' }))

		const response = await app.handle(upload(form))

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({
			kind: 'object',
			value: { theme: 'dark' }
		})
	})

	it('preserve JSON text as string when a sibling field has a default', async () => {
		const app = new Elysia().post(
			'/upload',
			({ body }) => ({
				name: body.name,
				metadata: body.metadata
			}),
			{
				body: t.Object({
					name: t.String({ default: 'anon' }),
					metadata: t.String()
				}),
				type: 'multipart'
			}
		)

		const metadata = JSON.stringify({ a: 1 })
		const form = new FormData()
		form.append('metadata', metadata)

		const response = await app.handle(upload(form))

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({
			name: 'anon',
			metadata
		})
	})

	it('parse structured field when a sibling field has a default', async () => {
		const app = new Elysia().post(
			'/upload',
			({ body }) => ({
				name: body.name,
				settings: body.settings
			}),
			{
				body: t.Object({
					name: t.String({ default: 'anon' }),
					settings: t.Object({
						theme: t.String()
					})
				}),
				type: 'multipart'
			}
		)

		const form = new FormData()
		form.append('settings', JSON.stringify({ theme: 'dark' }))

		const response = await app.handle(upload(form))

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({
			name: 'anon',
			settings: { theme: 'dark' }
		})
	})
})
