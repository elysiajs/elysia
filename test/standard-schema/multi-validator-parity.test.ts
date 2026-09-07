import { describe, it, expect } from 'bun:test'
import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import { post, json } from '../utils'
import { z } from 'zod'

// Returns no fields so each test isolates the TypeBox member.
const passthrough = {
	'~standard': {
		version: 1,
		vendor: 'parity-test-passthrough',
		validate: (value: unknown) => ({ value: {} })
	}
} as any

describe('TypeBox query coercion with Standard Schema guards', () => {
	it('coerces numeric strings without a guard', async () => {
		const app = new Elysia().get(
			'/',
			{ query: t.Object({ page: t.Number() }) },
			({ query }) => query
		)

		const res = await app.handle('/?page=5').then((x) => x.json())

		expect(res.page).toBe(5)
	})

	it('coerces numeric strings with a merge Standard Schema guard', async () => {
		const app = new Elysia()
			.guard({
				schema: 'merge',
				query: passthrough
			})
			.get(
				'/',
				{ query: t.Object({ page: t.Number() }) },
				({ query }) => query
			)

		const res = await app.handle('/?page=5').then((x) => x.json())

		expect(res.page).toBe(5)
	})

	it('rejects non-numeric strings with a merge Standard Schema guard', async () => {
		const app = new Elysia()
			.guard({ schema: 'merge', query: passthrough })
			.get(
				'/',
				{ query: t.Object({ page: t.Number() }) },
				({ query }) => query
			)

		const res = await app.handle('/?page=abc')
		expect(res.status).toBe(422)
	})
})

describe('TypeBox defaults with Standard Schema guards', () => {
	it('applies defaults without a guard', async () => {
		const app = new Elysia().get(
			'/',
			{ query: t.Object({ page: t.Number({ default: 1 }) }) },
			({ query }) => query
		)

		const res = await app.handle('/').then((x) => x.json())
		expect(res).toEqual({ page: 1 })
	})

	it('applies defaults with a merge Standard Schema guard', async () => {
		const app = new Elysia()
			.guard({ schema: 'merge', query: passthrough })
			.get(
				'/',
				{ query: t.Object({ page: t.Number({ default: 1 }) }) },
				({ query }) => query
			)

		const res = await app.handle('/').then((x) => x.json())
		expect(res).toEqual({ page: 1 })
	})

	it('keeps provided values instead of applying defaults', async () => {
		const app = new Elysia()
			.guard({ schema: 'merge', query: passthrough })
			.get(
				'/',
				{ query: t.Object({ page: t.Number({ default: 1 }) }) },
				({ query }) => query
			)

		const res = await app.handle('/?page=7').then((x) => x.json())
		expect(res.page).toBe(7)
	})

	it('applies defaults through Validator.create', () => {
		const single = Validator.create(
			t.Object({ page: t.Number({ default: 1 }), name: t.String() }),
			{}
		)!
		const singleResult = (single as any).FromSync(
			{ name: 'lilith' },
			'body'
		)
		expect(singleResult).toEqual({ page: 1, name: 'lilith' })

		const multi = Validator.create(
			t.Object({ page: t.Number({ default: 1 }), name: t.String() }),
			{ schemas: [passthrough] }
		)!
		const multiResult = (multi as any).From({ name: 'lilith' }, 'body')
		expect(multiResult).toEqual({ page: 1, name: 'lilith' })
	})
})

describe('TypeBox normalization with Standard Schema guards', () => {
	it('rejects extra fields without a guard when normalize is false', async () => {
		const app = new Elysia({ normalize: false }).post(
			'/',
			{ body: t.Object({ name: t.String() }) },
			({ body }) => body
		)

		const res = await app.handle('/', json({ name: 'lilith', extra: true }))
		expect(res.status).toBe(422)
	})

	it('rejects extra fields with a merge guard when normalize is false', async () => {
		const app = new Elysia({ normalize: false })
			.guard({ schema: 'merge', body: passthrough })
			.post(
				'/',
				{ body: t.Object({ name: t.String() }) },
				({ body }) => body
			)

		const res = await app.handle('/', json({ name: 'lilith', extra: true }))
		expect(res.status).toBe(422)
	})

	it('accepts declared fields with a merge guard', async () => {
		const app = new Elysia({ normalize: false })
			.guard({ schema: 'merge', body: passthrough })
			.post(
				'/',
				{ body: t.Object({ name: t.String() }) },
				({ body }) => body
			)

		const res = await app.handle('/', json({ name: 'lilith' }))
		expect(res.status).toBe(200)
	})

	it('rejects extra fields through Validator.create', () => {
		const single = Validator.create(t.Object({ name: t.String() }), {
			normalize: false
		})!
		expect(() =>
			(single as any).FromSync({ name: 'lilith', extra: true }, 'body')
		).toThrow()

		const multi = Validator.create(t.Object({ name: t.String() }), {
			schemas: [passthrough],
			normalize: false
		})!
		expect(() =>
			(multi as any).From({ name: 'lilith', extra: true }, 'body')
		).toThrow()
	})
})

describe('TypeBox file validation with Standard Schema guards', () => {
	it('marks a MIME type validator as async', () => {
		const v = Validator.create(t.File({ type: 'image/jpeg' }), {
			coerces: undefined as any
		})
		expect(v!.isAsync).toBe(true)
	})

	it('marks a mixed validator with a MIME type schema as async', () => {
		const v = Validator.create(passthrough, {
			schemas: [t.File({ type: 'image/jpeg' }) as any]
		})
		expect(v!.constructor.name).toBe('MultiValidator')
		expect(v!.isAsync).toBe(true)
	})

	it('rejects a mismatched MIME type with a merge guard', async () => {
		const app = new Elysia()
			.guard({ schema: 'merge', body: passthrough })
			.post(
				'/',
				{ body: t.File({ type: 'image/jpeg' }) },
				({ body }) => ({ ok: true })
			)

		const form = new FormData()
		form.append(
			'file',
			new Blob(['dummy'], { type: 'image/png' }),
			'img.png'
		)

		const res = await app.handle(
			new Request('http://localhost/', { method: 'POST', body: form })
		)
		expect(res.status).toBe(422)
	})
})
