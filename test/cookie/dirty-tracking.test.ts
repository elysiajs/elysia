import { describe, it, expect } from 'bun:test'
import { Elysia, t } from '../../src'
import { signCookie } from '../../src/cookie/crypto'

const jsonCookie = (name: string, value: unknown) =>
	`${name}=${encodeURIComponent(JSON.stringify(value))}`

describe('object cookie dirty tracking', () => {
	it('emits Set-Cookie for pure in-place mutation', async () => {
		const app = new Elysia().post('/bump', ({ cookie: { data } }) => {
			;(data.value as { count: number }).count++
			return 'ok'
		})

		const res = await app.handle(
			new Request('http://localhost/bump', {
				method: 'POST',
				headers: { cookie: jsonCookie('data', { count: 1 }) }
			})
		)

		const header = res.headers.get('set-cookie')
		expect(header).toBeTruthy()
		expect(decodeURIComponent(header!)).toContain('{"count":2}')
	})

	it('emits Set-Cookie for mutate-and-reassign of the same reference', async () => {
		const app = new Elysia().post('/bump', ({ cookie: { data } }) => {
			const v = data.value as { count: number }
			v.count++
			data.value = v
			return 'ok'
		})

		const res = await app.handle(
			new Request('http://localhost/bump', {
				method: 'POST',
				headers: { cookie: jsonCookie('data', { count: 1 }) }
			})
		)

		expect(decodeURIComponent(res.headers.get('set-cookie')!)).toContain(
			'{"count":2}'
		)
	})

	it('does not emit for read-only access to an object cookie', async () => {
		const app = new Elysia().get(
			'/read',
			({ cookie: { data } }) => (data.value as { count: number }).count
		)

		const res = await app.handle(
			new Request('http://localhost/read', {
				headers: { cookie: jsonCookie('data', { count: 5 }) }
			})
		)

		expect(res.headers.getAll('set-cookie').length).toBe(0)
		await expect(res.text()).resolves.toBe('5')
	})

	it('emits when only a cookie attribute changes on an unchanged value', async () => {
		const app = new Elysia().get('/attr', ({ cookie: { data } }) => {
			data.path = '/x'
			return 'ok'
		})

		const res = await app.handle(
			new Request('http://localhost/attr', {
				headers: { cookie: jsonCookie('data', { k: 1 }) }
			})
		)

		expect(res.headers.get('set-cookie')).toContain('Path=/x')
	})

	it('falls back to the raw string on malformed percent-encoding', async () => {
		const app = new Elysia().get(
			'/m',
			({ cookie: { v } }) => v.value ?? 'MISSING'
		)

		const res = await app.handle(
			new Request('http://localhost/m', {
				headers: { cookie: 'v=100%' }
			})
		)

		await expect(res.text()).resolves.toBe('100%')
	})
})

describe('schema-validated object cookie dirty tracking', () => {
	const schema = {
		cookie: t.Cookie({
			data: t.Optional(t.Object({ count: t.Number() }))
		})
	}

	const build = (compiled: boolean) => {
		const app = new Elysia()
			.get('/bump', schema, ({ cookie: { data } }: any) => {
				if (data.value) (data.value as { count: number }).count++
				return 'ok'
			})
			.get('/read', schema, ({ cookie: { data } }: any) =>
				String((data.value as { count: number })?.count)
			)
			.get('/noop', schema, ({ cookie: { data } }: any) => {
				const v = data.value as { count: number }
				if (v) v.count = v.count
				return 'ok'
			})
			.get('/reassign', schema, ({ cookie: { data } }: any) => {
				data.value = { count: 99 }
				return 'ok'
			})
		return compiled ? app.compile() : app
	}

	for (const compiled of [true, false])
		describe(compiled ? 'compiled handler' : 'interpreted handler', () => {
			it('emits Set-Cookie for in-place mutation', async () => {
				const app = build(compiled)
				const res = await app.handle(
					new Request('http://localhost/bump', {
						headers: { cookie: jsonCookie('data', { count: 1 }) }
					})
				)
				const header = res.headers.get('set-cookie')
				expect(header).toBeTruthy()
				expect(decodeURIComponent(header!)).toContain('{"count":2}')
			})

			it('does not emit for read-only access', async () => {
				const app = build(compiled)
				const res = await app.handle(
					new Request('http://localhost/read', {
						headers: { cookie: jsonCookie('data', { count: 5 }) }
					})
				)
				expect(res.headers.getAll('set-cookie').length).toBe(0)
				await expect(res.text()).resolves.toBe('5')
			})

			it('does not emit for a no-op mutation', async () => {
				const app = build(compiled)
				const res = await app.handle(
					new Request('http://localhost/noop', {
						headers: { cookie: jsonCookie('data', { count: 7 }) }
					})
				)
				expect(res.headers.getAll('set-cookie').length).toBe(0)
			})

			it('emits for a reassigned value', async () => {
				const app = build(compiled)
				const res = await app.handle(
					new Request('http://localhost/reassign', {
						headers: { cookie: jsonCookie('data', { count: 1 }) }
					})
				)
				expect(
					decodeURIComponent(res.headers.get('set-cookie')!)
				).toContain('{"count":99}')
			})
		})

	const signApp = (compiled: boolean) => {
		const app = new Elysia({
			cookie: { secrets: 'sekret', sign: ['session'] }
		})
			.get(
				'/bump',
				{
					cookie: t.Cookie({
						session: t.Optional(t.Object({ count: t.Number() }))
					})
				},
				({ cookie: { session } }: any) => {
					if (session.value) session.value.count++
					return 'ok'
				}
			)
			.get(
				'/read',
				{
					cookie: t.Cookie({
						session: t.Optional(t.Object({ count: t.Number() }))
					})
				},
				({ cookie: { session } }: any) => String(session.value?.count)
			)
		return compiled ? app.compile() : app
	}

	for (const compiled of [true, false])
		describe(
			compiled ? 'compiled signed handler' : 'interpreted signed handler',
			() => {
				it('re-signs mutations without re-signing read-only values', async () => {
					const signed = await signCookie(
						JSON.stringify({ count: 5 }),
						'sekret'
					)
					const cookie = 'session=' + encodeURIComponent(signed)

					const bump = await signApp(compiled).handle(
						new Request('http://localhost/bump', {
							headers: { cookie }
						})
					)
					expect(bump.status).toBe(200)
					expect(bump.headers.get('set-cookie')).toBeTruthy()

					const read = await signApp(compiled).handle(
						new Request('http://localhost/read', {
							headers: { cookie }
						})
					)
					expect(read.status).toBe(200)
					expect(read.headers.getAll('set-cookie').length).toBe(0)
				})
			}
		)
})
