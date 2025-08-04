import { Elysia, t, ValidationError } from '../../src'

import { describe, expect, it } from 'bun:test'
import { post, upload } from '../utils'

describe('Body Validator', () => {
	it('skip body parsing if body is empty but headers is present', async () => {
		const app = new Elysia().post('/', ({ body }) => 'ok')

		const response = await app.handle(
			new Request('http://localhost', {
				method: 'POST',
				headers: {
					'content-type': 'application/json'
				}
			})
		)

		expect(response.status).toBe(200)
	})

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

	it('handle file upload using model reference', async () => {
		const app = new Elysia()
			.model({
				a: t.Object({
					message: t.String(),
					image: t.Optional(t.Files())
				})
			})
			.post('/', ({ body }) => 'ok', {
				body: 'a'
			})

		const { request } = upload('/', {
			message: 'Hello, world!'
		})

		const status = await app.handle(request).then((r) => r.status)

		expect(status).toBe(200)
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
			// expect(+response).toBe(size)
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

	it('validate actual file', async () => {
		const app = new Elysia().post(
			'/upload',
			({ body: { file } }) => file.size,
			{
				body: t.Object({
					file: t.File({
						type: 'image'
					})
				})
			}
		)

		{
			const { request, size } = upload('/upload', {
				file: 'millenium.jpg'
			})

			const response = await app.handle(request).then((r) => r.text())
			expect(+response).toBe(size)
		}

		{
			const { request, size } = upload('/upload', {
				file: 'fake.jpg'
			})

			const status = await app.handle(request).then((r) => r.status)
			expect(status).toBe(422)
		}
	})

	it('validate actual file with multiple type', async () => {
		const app = new Elysia().post(
			'/upload',
			({ body: { file } }) => file.size,
			{
				body: t.Object({
					file: t.File({
						type: ['image/png', 'image/jpeg']
					})
				})
			}
		)

		{
			const { request, size } = upload('/upload', {
				file: 'millenium.jpg'
			})

			const response = await app.handle(request).then((r) => r.text())
			expect(+response).toBe(size)
		}

		{
			const { request, size } = upload('/upload', {
				file: 'fake.jpg'
			})

			const status = await app.handle(request).then((r) => r.status)
			expect(status).toBe(422)
		}

		{
			const { request, size } = upload('/upload', {
				file: 'kozeki-ui.webp'
			})

			const status = await app.handle(request).then((r) => r.status)
			expect(status).toBe(422)
		}
	})

	it('validate actual file type union', async () => {
		const app = new Elysia().post('/', ({ body }) => 'ok', {
			body: t.Union([
				t.Object({
					hello: t.String(),
					file: t.File({
						type: 'image'
					})
				}),
				t.Object({
					world: t.String(),
					image: t.File({
						type: 'image'
					})
				}),
				t.Object({
					donQuixote: t.String()
				})
			])
		})

		// case 1 pass
		{
			const { request, size } = upload('/', {
				hello: 'ok',
				file: 'millenium.jpg'
			})

			const status = await app.handle(request).then((r) => r.status)
			expect(status).toBe(200)
		}

		// case 1 fail
		{
			const { request, size } = upload('/', {
				hello: 'ok',
				file: 'fake.jpg'
			})

			const status = await app.handle(request).then((r) => r.status)
			expect(status).toBe(422)
		}

		// case 2 pass
		{
			const { request, size } = upload('/', {
				world: 'ok',
				image: 'millenium.jpg'
			})

			const status = await app.handle(request).then((r) => r.status)
			expect(status).toBe(200)
		}

		// case 2 fail
		{
			const { request, size } = upload('/', {
				world: 'ok',
				image: 'fake.jpg'
			})

			const status = await app.handle(request).then((r) => r.status)
			expect(status).toBe(422)
		}

		// case 3 fail
		{
			const { request, size } = upload('/', {
				donQuixote: 'Limbus Company!'
			})

			const status = await app.handle(request).then((r) => r.status)
			expect(status).toBe(200)
		}
	})

	it('validate actual file type union with multiple file type', async () => {
		const app = new Elysia().post('/', ({ body }) => 'ok', {
			body: t.Union([
				t.Object({
					hello: t.String(),
					file: t.File({
						type: 'image'
					})
				}),
				t.Object({
					world: t.String(),
					image: t.File({
						type: ['image/png', 'image/jpeg']
					})
				}),
				t.Object({
					donQuixote: t.String()
				})
			])
		})

		// case 1 pass
		{
			const { request, size } = upload('/', {
				hello: 'ok',
				file: 'millenium.jpg'
			})

			const status = await app.handle(request).then((r) => r.status)
			expect(status).toBe(200)
		}

		// case 1 fail
		{
			const { request, size } = upload('/', {
				hello: 'ok',
				file: 'fake.jpg'
			})

			const status = await app.handle(request).then((r) => r.status)
			expect(status).toBe(422)
		}

		// case 2 pass
		{
			const { request, size } = upload('/', {
				world: 'ok',
				image: 'millenium.jpg'
			})

			const status = await app.handle(request).then((r) => r.status)
			expect(status).toBe(200)
		}

		// case 2 fail by fake image
		{
			const { request, size } = upload('/', {
				world: 'ok',
				image: 'fake.jpg'
			})

			const status = await app.handle(request).then((r) => r.status)
			expect(status).toBe(422)
		}

		// case 2 fail by incorrect image type
		{
			const { request, size } = upload('/', {
				world: 'ok',
				image: 'kozeki-ui.webp'
			})

			const status = await app.handle(request).then((r) => r.status)
			expect(status).toBe(422)
		}

		// case 3 fail
		{
			const { request, size } = upload('/', {
				donQuixote: 'Limbus Company!'
			})

			const status = await app.handle(request).then((r) => r.status)
			expect(status).toBe(200)
		}
	})

	it('validate actual files', async () => {
		const app = new Elysia().post('/', () => 'ok', {
			body: t.Object({
				file: t.Files({
					type: 'image'
				})
			})
		})

		// case 1 fail: contains fake image
		{
			const body = new FormData()
			body.append('file', Bun.file('test/images/fake.jpg'))
			body.append('file', Bun.file('test/images/kozeki-ui.webp'))

			const response = await app.handle(
				new Request('http://localhost/', {
					method: 'POST',
					body
				})
			)

			expect(response.status).toBe(422)
		}

		// case 2 pass: all valid images
		{
			const body = new FormData()
			body.append('file', Bun.file('test/images/millenium.jpg'))
			body.append('file', Bun.file('test/images/kozeki-ui.webp'))

			const response = await app.handle(
				new Request('http://localhost/', {
					method: 'POST',
					body
				})
			)

			expect(response.status).toBe(200)
		}
	})

	it('handle body using Transform with Intersect ', async () => {
		const app = new Elysia().post('/test', ({ body }) => body, {
			body: t.Intersect([
				t.Object({ foo: t.String() }),
				t.Object({
					field: t
						.Transform(t.String())
						.Decode((decoded) => ({ decoded }))
						.Encode((v) => v.decoded)
				})
			])
		})

		const response = await app
			.handle(
				new Request('http://localhost/test', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({ field: 'bar', foo: 'test' })
				})
			)
			.then((x) => x.json())

		expect(response).toEqual({ field: { decoded: 'bar' }, foo: 'test' })
	})

	it('right rejects missed field with model', async () => {
		const model = new Elysia().model(
			'user',
			t.Object({
				username: t.String(),
				age: t.Integer()
			})
		)

		const app = new Elysia().use(model).post('/', ({ body }) => body, {
			body: 'user'
		})
		const res = await app.handle(
			post('/', {
				name: 'sucrose'
			})
		)

		expect(res.status).toBe(422)
	})

	it('handle coerce TransformDecodeError', async () => {
		let err: Error | undefined

		const app = new Elysia()
			.post('/', ({ body }) => body, {
				body: t.Object({
					year: t.Numeric({ minimum: 1900, maximum: 2160 })
				}),
				error({ code, error }) {
					switch (code) {
						case 'VALIDATION':
							err = error
					}
				}
			})
			.listen(0)

		await app.handle(
			post('/', {
				year: '3000'
			})
		)

		expect(err instanceof ValidationError).toBe(true)
	})
})
