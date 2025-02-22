import { Elysia, t } from '../../src'

import { describe, expect, it } from 'bun:test'
import { post, upload } from '../utils'

describe('Body Validator', () => {
	it('validate single', async () => {
		const app = new Elysia().post('/', ({ body: { name } }) => name, {
			body: t.Object({
				name: t.String()
			})
		})
		const res = await app.handle(
			post('/', {
				name: 'sucrose'
			})
		)

		expect(await res.text()).toBe('sucrose')
		expect(res.status).toBe(200)
	})

	it('validate multiple', async () => {
		const app = new Elysia().post('/', ({ body }) => body, {
			body: t.Object({
				name: t.String(),
				job: t.String(),
				trait: t.String()
			})
		})
		const res = await app.handle(
			post('/', {
				name: 'sucrose',
				job: 'alchemist',
				trait: 'dog'
			})
		)

		expect(await res.json()).toEqual({
			name: 'sucrose',
			job: 'alchemist',
			trait: 'dog'
		})
		expect(res.status).toBe(200)
	})

	it('parse without reference', async () => {
		const app = new Elysia().post('/', () => '', {
			body: t.Object({
				name: t.String(),
				job: t.String(),
				trait: t.String()
			})
		})
		const res = await app.handle(
			post('/', {
				name: 'sucrose',
				job: 'alchemist',
				trait: 'dog'
			})
		)

		expect(res.status).toBe(200)
	})

	it('validate optional', async () => {
		const app = new Elysia().post('/', ({ body }) => body, {
			body: t.Object({
				name: t.String(),
				job: t.String(),
				trait: t.Optional(t.String())
			})
		})
		const res = await app.handle(
			post('/', {
				name: 'sucrose',
				job: 'alchemist'
			})
		)

		expect(await res.json()).toEqual({
			name: 'sucrose',
			job: 'alchemist'
		})
		expect(res.status).toBe(200)
	})

	it('parse single numeric', async () => {
		const app = new Elysia().post('/', ({ body }) => body, {
			body: t.Object({
				name: t.String(),
				job: t.String(),
				trait: t.Optional(t.String()),
				age: t.Numeric()
			})
		})

		const res = await app.handle(
			post('/', {
				name: 'sucrose',
				job: 'alchemist',
				age: '16'
			})
		)

		expect(await res.json()).toEqual({
			name: 'sucrose',
			job: 'alchemist',
			age: 16
		})

		expect(res.status).toBe(200)
	})

	it('parse multiple numeric', async () => {
		const app = new Elysia().post('/', ({ body }) => body, {
			body: t.Object({
				name: t.String(),
				job: t.String(),
				trait: t.Optional(t.String()),
				age: t.Numeric(),
				rank: t.Numeric()
			})
		})
		const res = await app.handle(
			post('/', {
				name: 'sucrose',
				job: 'alchemist',
				age: '16',
				rank: '4'
			})
		)

		expect(await res.json()).toEqual({
			name: 'sucrose',
			job: 'alchemist',
			age: 16,
			rank: 4
		})
		expect(res.status).toBe(200)
	})

	it('parse single integer', async () => {
		const app = new Elysia().post('/', ({ body }) => body, {
			body: t.Object({
				name: t.String(),
				job: t.String(),
				trait: t.Optional(t.String()),
				age: t.Integer()
			})
		})
		const res = await app.handle(
			post('/', {
				name: 'sucrose',
				job: 'alchemist',
				age: '16'
			})
		)

		expect(await res.json()).toEqual({
			name: 'sucrose',
			job: 'alchemist',
			age: 16
		})

		expect(res.status).toBe(200)
	})

	it('parse multiple integers', async () => {
		const app = new Elysia().post('/', ({ body }) => body, {
			body: t.Object({
				name: t.String(),
				job: t.String(),
				trait: t.Optional(t.String()),
				age: t.Integer(),
				rank: t.Integer()
			})
		})
		const res = await app.handle(
			post('/', {
				name: 'sucrose',
				job: 'alchemist',
				age: '16',
				rank: '4'
			})
		)

		expect(await res.json()).toEqual({
			name: 'sucrose',
			job: 'alchemist',
			age: 16,
			rank: 4
		})
		expect(res.status).toBe(200)
	})

	it('rejects malformed integer from array object', async () => {
		const app = new Elysia().post('/', ({ body }) => body, {
			body: t.Array(
				t.Object({
					name: t.String(),
					job: t.String(),
					trait: t.Optional(t.String()),
					age: t.Integer(),
					rank: t.Integer()
				})
			)
		})
		const res = await app.handle(
			post('/', [
				{
					name: 'sucrose',
					job: 'alchemist',
					age: 16.4,
					rank: 4
				}
			])
		)

		expect(res.status).toBe(422)
	})

	it('rejects malformed integer directly in array', async () => {
		const app = new Elysia().post('/', ({ body }) => body, {
			body: t.Array(t.Integer())
		})
		const res = await app.handle(post('/', [1, 2, 3, 4.2]))

		expect(res.status).toBe(422)
	})
	it('validate empty body', async () => {
		const app = new Elysia().post('/', ({ body }) => body, {
			body: t.Union([
				t.Undefined(),
				t.Object({
					name: t.String(),
					job: t.String(),
					trait: t.Optional(t.String())
				})
			])
		})
		const res = await app.handle(
			new Request('http://localhost/', {
				method: 'POST'
			})
		)

		expect(res.status).toBe(200)
		expect(await res.text()).toBe('')
	})

	it('validate empty body with partial', async () => {
		const app = new Elysia().post('/', ({ body }) => body, {
			body: t.Union([
				t.Undefined(),
				t.Object({
					name: t.String(),
					job: t.String(),
					trait: t.Optional(t.String()),
					age: t.Numeric(),
					rank: t.Numeric()
				})
			])
		})
		const res = await app.handle(
			new Request('http://localhost/', {
				method: 'POST'
			})
		)

		expect(res.status).toBe(200)
		expect(await res.text()).toEqual('')
	})

	it('normalize by default', async () => {
		const app = new Elysia().post('/', ({ body }) => body, {
			body: t.Object({
				name: t.String()
			})
		})

		const res = await app
			.handle(
				post('/', {
					name: 'sucrose',
					job: 'alchemist'
				})
			)
			.then((x) => x.json())

		expect(res).toEqual({
			name: 'sucrose'
		})
	})

	it('strictly validate if not normalize', async () => {
		const app = new Elysia({ normalize: false }).post(
			'/',
			({ body }) => body,
			{
				body: t.Object({
					name: t.String()
				})
			}
		)

		const res = await app.handle(
			post('/', {
				name: 'sucrose',
				job: 'alchemist'
			})
		)

		expect(res.status).toBe(422)
	})

	it('validate maybe empty body', async () => {
		const app = new Elysia().post('/', ({ body }) => body, {
			body: t.MaybeEmpty(
				t.Object({
					name: t.String(),
					job: t.String(),
					trait: t.Optional(t.String())
				})
			)
		})
		const res = await app.handle(
			new Request('http://localhost/', {
				method: 'POST'
			})
		)

		expect(res.status).toBe(200)
		expect(await res.text()).toBe('')
	})

	it('validate record', async () => {
		const app = new Elysia().post('/', ({ body: { name } }) => name, {
			body: t.Record(t.String(), t.String())
		})
		const res = await app.handle(
			post('/', {
				name: 'sucrose'
			})
		)

		expect(await res.text()).toBe('sucrose')
		expect(res.status).toBe(200)
	})

	it('validate record inside object', async () => {
		const app = new Elysia().post(
			'/',
			({ body: { name, friends } }) =>
				`${name} ~ ${Object.keys(friends).join(' + ')}`,
			{
				body: t.Object({
					name: t.String(),
					friends: t.Record(t.String(), t.String())
				})
			}
		)
		const res = await app.handle(
			post('/', {
				name: 'sucrose',
				friends: {
					amber: 'wizard',
					lisa: 'librarian'
				}
			})
		)

		expect(await res.text()).toBe('sucrose ~ amber + lisa')
		expect(res.status).toBe(200)
	})

	it('validate optional primitive', async () => {
		const app = new Elysia().post('/', ({ body }) => body ?? 'sucrose', {
			body: t.Optional(t.String())
		})

		const [valid, invalid] = await Promise.all([
			app.handle(
				new Request('http://localhost/', {
					method: 'POST',
					headers: {
						'Content-Type': 'text/plain'
					},
					body: 'sucrose'
				})
			),
			app.handle(
				new Request('http://localhost/', {
					method: 'POST'
				})
			)
		])

		expect(await valid.text()).toBe('sucrose')
		expect(valid.status).toBe(200)

		expect(await invalid.text()).toBe('sucrose')
		expect(invalid.status).toBe(200)
	})

	it('validate optional object', async () => {
		const app = new Elysia().post(
			'/',
			({ body }) => body?.name ?? 'sucrose',
			{
				body: t.Optional(
					t.Object({
						name: t.String()
					})
				)
			}
		)

		const [valid, invalid] = await Promise.all([
			app.handle(
				post('/', {
					name: 'sucrose'
				})
			),
			app.handle(
				new Request('http://localhost/', {
					method: 'POST'
				})
			)
		])

		expect(await valid.text()).toBe('sucrose')
		expect(valid.status).toBe(200)

		expect(await invalid.text()).toBe('sucrose')
		expect(invalid.status).toBe(200)
	})

	it('create default object body', async () => {
		const app = new Elysia().post('/', ({ body }) => body, {
			body: t.Object({
				username: t.String(),
				password: t.String(),
				email: t.Optional(t.String({ format: 'email' })),
				isSuperuser: t.Boolean({ default: false })
			})
		})

		const value = await app
			.handle(
				post('/', {
					username: 'nagisa',
					password: 'hifumi_daisuki',
					email: 'kirifuji_nagisa@trinity.school'
				})
			)
			.then((x) => x.json())

		expect(value).toEqual({
			username: 'nagisa',
			password: 'hifumi_daisuki',
			email: 'kirifuji_nagisa@trinity.school',
			isSuperuser: false
		})
	})

	it('create default string body', async () => {
		const app = new Elysia().post('/', ({ body }) => body, {
			body: t.String({ default: 'hifumi_daisuki' })
		})

		const value = await app.handle(post('/')).then((x) => x.text())

		expect(value).toBe('hifumi_daisuki')
	})

	it('create default boolean body', async () => {
		const app = new Elysia().post('/', ({ body }) => typeof body, {
			body: t.Boolean({ default: true })
		})

		const value = await app.handle(post('/')).then((x) => x.text())

		expect(value).toBe('boolean')
	})

	it('create default number body', async () => {
		const app = new Elysia().post('/', ({ body }) => typeof body, {
			body: t.Number({ default: 1 })
		})

		const value = await app.handle(post('/')).then((x) => x.text())

		expect(value).toBe('number')
	})

	it('create default numeric body', async () => {
		const app = new Elysia().post('/', ({ body }) => typeof body, {
			body: t.Numeric({ default: 1 })
		})

		const value = await app.handle(post('/')).then((x) => x.text())

		expect(value).toBe('number')
	})

	it('coerce number to numeric', async () => {
		const app = new Elysia().post('/', ({ body }) => typeof body, {
			body: t.Number()
		})

		const response = await app.handle(
			new Request('http://localhost/', {
				method: 'POST',
				headers: {
					'Content-Type': 'text/plain'
				},
				body: '1'
			})
		)

		expect(response.status).toBe(200)
	})

	it("don't coerce number object to numeric", async () => {
		const app = new Elysia().post('/', ({ body: { id } }) => typeof id, {
			body: t.Object({
				id: t.Number()
			})
		})

		const response = await app.handle(
			post('/', {
				id: '1'
			})
		)

		expect(response.status).toBe(422)
	})

	it('coerce string to boolean', async () => {
		const app = new Elysia().post('/', ({ body }) => typeof body, {
			body: t.Boolean()
		})

		const response = await app.handle(
			new Request('http://localhost/', {
				method: 'POST',
				headers: {
					'Content-Type': 'text/plain'
				},
				body: 'true'
			})
		)

		expect(response.status).toBe(200)
	})

	it("don't coerce string object to boolean", async () => {
		const app = new Elysia().post('/', ({ body: { id } }) => typeof id, {
			body: t.Object({
				id: t.Boolean()
			})
		})

		const response = await app.handle(
			post('/', {
				id: 'true'
			})
		)

		expect(response.status).toBe(422)
	})

	it('handle optional at root', async () => {
		const app = new Elysia().post('/', ({ body }) => body, {
			body: t.Optional(
				t.Object({
					id: t.Numeric()
				})
			)
		})

		const res = await Promise.all([
			app.handle(post('/')).then((x) => x.json()),
			app
				.handle(
					post('/', {
						id: 1
					})
				)
				.then((x) => x.json())
		])

		expect(res).toEqual([{}, { id: 1 }])
	})

	it('parse query body with array', async () => {
		const app = new Elysia().post('/', ({ body }) => body)

		const res = await app.handle(
			new Request('https://e.ly', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded'
				},
				body: `tea_party=nagisa&tea_party=mika&tea_party=seia`
			})
		)

		expect(await res.json()).toEqual({
			tea_party: ['nagisa', 'mika', 'seia']
		})
		expect(res.status).toBe(200)
	})

	it('validate references', async () => {
		const job = t.Object(
			{
				name: t.String()
			},
			{ $id: 'job' }
		)

		const person = t.Object({
			name: t.String(),
			job: t.Ref(job)
		})

		const app = new Elysia()
			.model({ job, person })
			.post('/', ({ body: { name, job } }) => `${name} - ${job.name}`, {
				body: person
			})

		const res = await app.handle(
			post('/', {
				name: 'sucrose',
				job: { name: 'alchemist' }
			})
		)

		expect(await res.text()).toBe('sucrose - alchemist')
		expect(res.status).toBe(200)
	})

	it('handle file upload', async () => {
		const app = new Elysia().post(
			'/single',
			({ body: { file } }) => file.size,
			{
				body: t.Object({
					file: t.File()
				})
			}
		)

		const { request, size } = upload('/single', {
			file: 'millenium.jpg'
		})

		const response = await app.handle(request).then((r) => r.text())

		expect(+response).toBe(size)
	})

	it('handle file prefix', async () => {
		const app = new Elysia()
			.post('/pass1', ({ body: { file } }) => file.size, {
				body: t.Object({
					file: t.File({
						type: 'image/*'
					})
				})
			})
			.post('/pass2', ({ body: { file } }) => file.size, {
				body: t.Object({
					file: t.File({
						type: ['application/*', 'image/*']
					})
				})
			})
			.post('/fail', ({ body: { file } }) => file.size, {
				body: t.Object({
					file: t.File({
						type: 'application/*'
					})
				})
			})

		{
			const { request, size } = upload('/pass1', {
				file: 'millenium.jpg'
			})

			const response = await app.handle(request).then((r) => r.text())
			expect(+response).toBe(size)
		}

		{
			const { request, size } = upload('/pass2', {
				file: 'millenium.jpg'
			})

			const response = await app.handle(request).then((r) => r.text())
			expect(+response).toBe(size)
		}

		{
			const { request } = upload('/fail', {
				file: 'millenium.jpg'
			})

			const status = await app.handle(request).then((r) => r.status)
			expect(status).toBe(422)
		}
	})

	it('handle file type', async () => {
		const app = new Elysia()
			.post('/pass1', ({ body: { file } }) => file.size, {
				body: t.Object({
					file: t.File({
						type: 'image/jpeg'
					})
				})
			})
			.post('/pass2', ({ body: { file } }) => file.size, {
				body: t.Object({
					file: t.File({
						type: ['image/png', 'image/jpeg']
					})
				})
			})
			.post('/fail', ({ body: { file } }) => file.size, {
				body: t.Object({
					file: t.File({
						type: 'image/png'
					})
				})
			})

		{
			const { request, size } = upload('/pass1', {
				file: 'millenium.jpg'
			})

			const response = await app.handle(request).then((r) => r.text())
			expect(+response).toBe(size)
		}

		{
			const { request, size } = upload('/pass2', {
				file: 'millenium.jpg'
			})

			const response = await app.handle(request).then((r) => r.text())
			expect(+response).toBe(size)
		}

		{
			const { request } = upload('/fail', {
				file: 'millenium.jpg'
			})

			const status = await app.handle(request).then((r) => r.status)
			expect(status).toBe(422)
		}
	})

	it('handle file upload', async () => {
		const app = new Elysia().post(
			'/single',
			({ body: { file } }) => file.size,
			{
				body: t.Object({
					file: t.File()
				})
			}
		)

		const { request, size } = upload('/single', {
			file: 'millenium.jpg'
		})

		const response = await app.handle(request).then((r) => r.text())

		expect(+response).toBe(size)
	})

	it('handle file prefix', async () => {
		const app = new Elysia()
			.post('/pass1', ({ body: { file } }) => file.size, {
				body: t.Object({
					file: t.File({
						type: 'image/*'
					})
				})
			})
			.post('/pass2', ({ body: { file } }) => file.size, {
				body: t.Object({
					file: t.File({
						type: ['application/*', 'image/*']
					})
				})
			})
			.post('/fail', ({ body: { file } }) => file.size, {
				body: t.Object({
					file: t.File({
						type: 'application/*'
					})
				})
			})

		{
			const { request, size } = upload('/pass1', {
				file: 'millenium.jpg'
			})

			const response = await app.handle(request).then((r) => r.text())
			expect(+response).toBe(size)
		}

		{
			const { request, size } = upload('/pass2', {
				file: 'millenium.jpg'
			})

			const response = await app.handle(request).then((r) => r.text())
			expect(+response).toBe(size)
		}

		{
			const { request } = upload('/fail', {
				file: 'millenium.jpg'
			})

			const status = await app.handle(request).then((r) => r.status)
			expect(status).toBe(422)
		}
	})

	it('handle file type', async () => {
		const app = new Elysia()
			.post('/pass1', ({ body: { file } }) => file.size, {
				body: t.Object({
					file: t.File({
						type: 'image/jpeg'
					})
				})
			})
			.post('/pass2', ({ body: { file } }) => file.size, {
				body: t.Object({
					file: t.File({
						type: ['image/png', 'image/jpeg']
					})
				})
			})
			.post('/fail', ({ body: { file } }) => file.size, {
				body: t.Object({
					file: t.File({
						type: 'image/png'
					})
				})
			})

		{
			const { request, size } = upload('/pass1', {
				file: 'millenium.jpg'
			})

			const response = await app.handle(request).then((r) => r.text())
			expect(+response).toBe(size)
		}

		{
			const { request, size } = upload('/pass2', {
				file: 'millenium.jpg'
			})

			const response = await app.handle(request).then((r) => r.text())
			expect(+response).toBe(size)
		}

		{
			const { request } = upload('/fail', {
				file: 'millenium.jpg'
			})

			const status = await app.handle(request).then((r) => r.status)
			expect(status).toBe(422)
		}
	})

	it('validate t.Transform()-body decoding', async () => {
		const app = new Elysia().post('/', ({ body }) => body, {
			body: t.Transform(t.Object({
				name: t.String()
			})).Decode((x) => x.name).Encode((x) => ({ name: x })),
			response: t.String()
		})

		const res = await app.handle(post('/', { name: 'difhel' }))

		expect(await res.text()).toBe('difhel')
		expect(res.status).toBe(200)
	})
})
