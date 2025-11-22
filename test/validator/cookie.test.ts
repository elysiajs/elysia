import { describe, expect, it } from 'bun:test'
import { Elysia, t } from '../../src'
import { req } from '../utils'

describe('Cookie Validation', () => {
	it('validate required cookie', async () => {
		const app = new Elysia().get(
			'/',
			({ cookie: { session } }) => session.value,
			{
				cookie: t.Cookie({
					session: t.String()
				})
			}
		)

		const [valid, invalid] = await Promise.all([
			app.handle(req('/', { headers: { Cookie: 'session=value' } })),
			app.handle(req('/'))
		])

		expect(valid.status).toBe(200)
		expect(await valid.text()).toBe('value')
		expect(invalid.status).toBe(422)
	})

	it('validate optional cookie', async () => {
		const app = new Elysia().get(
			'/',
			({ cookie: { session } }) => session.value ?? 'empty',
			{
				cookie: t.Cookie({
					session: t.Optional(t.String())
				})
			}
		)

		const [withCookie, withoutCookie] = await Promise.all([
			app.handle(req('/', { headers: { Cookie: 'session=value' } })),
			app.handle(req('/'))
		])

		expect(withCookie.status).toBe(200)
		expect(await withCookie.text()).toBe('value')
		expect(withoutCookie.status).toBe(200)
		expect(await withoutCookie.text()).toBe('empty')
	})

	it('validate cookie type - numeric', async () => {
		const app = new Elysia().get(
			'/',
			({ cookie: { count } }) => count.value,
			{
				cookie: t.Cookie({
					count: t.Numeric()
				})
			}
		)

		const [valid, invalid] = await Promise.all([
			app.handle(req('/', { headers: { Cookie: 'count=42' } })),
			app.handle(req('/', { headers: { Cookie: 'count=invalid' } }))
		])

		expect(valid.status).toBe(200)
		expect(await valid.text()).toBe('42')
		expect(invalid.status).toBe(422)
	})

	it('validate cookie type - boolean', async () => {
		const app = new Elysia().get(
			'/',
			({ cookie: { active } }) => active.value,
			{
				cookie: t.Cookie({
					active: t.BooleanString()
				})
			}
		)

		const [validTrue, validFalse, invalid] = await Promise.all([
			app.handle(req('/', { headers: { Cookie: 'active=true' } })),
			app.handle(req('/', { headers: { Cookie: 'active=false' } })),
			app.handle(req('/', { headers: { Cookie: 'active=maybe' } }))
		])

		expect(validTrue.status).toBe(200)
		expect(await validTrue.text()).toBe('true')
		expect(validFalse.status).toBe(200)
		expect(await validFalse.text()).toBe('false')
		expect(invalid.status).toBe(422)
	})

	it('validate cookie with object schema', async () => {
		const app = new Elysia().get(
			'/',
			({ cookie: { profile } }) => profile.value.name,
			{
				cookie: t.Cookie({
					profile: t.Object({
						name: t.String(),
						age: t.Numeric()
					})
				})
			}
		)

		const valid = await app.handle(
			req('/', {
				headers: {
					Cookie:
						'profile=' +
						encodeURIComponent(
							JSON.stringify({ name: 'Himari', age: 16 })
						)
				}
			})
		)

		const invalid = await app.handle(
			req('/', {
				headers: {
					Cookie:
						'profile=' +
						encodeURIComponent(JSON.stringify({ name: 'Himari' }))
				}
			})
		)

		expect(valid.status).toBe(200)
		expect(await valid.text()).toBe('Himari')
		expect(invalid.status).toBe(422)
	})

	it('validate multiple cookies', async () => {
		const app = new Elysia().get(
			'/',
			({ cookie: { session, userId } }) =>
				`${session.value}:${userId.value}`,
			{
				cookie: t.Cookie({
					session: t.String(),
					userId: t.Numeric()
				})
			}
		)

		const [valid, missingSession, missingUserId, invalidUserId] =
			await Promise.all([
				app.handle(
					req('/', {
						headers: { Cookie: 'session=abc123; userId=42' }
					})
				),
				app.handle(
					req('/', {
						headers: { Cookie: 'userId=42' }
					})
				),
				app.handle(
					req('/', {
						headers: { Cookie: 'session=abc123' }
					})
				),
				app.handle(
					req('/', {
						headers: { Cookie: 'session=abc123; userId=invalid' }
					})
				)
			])

		expect(valid.status).toBe(200)
		expect(await valid.text()).toBe('abc123:42')
		expect(missingSession.status).toBe(422)
		expect(missingUserId.status).toBe(422)
		expect(invalidUserId.status).toBe(422)
	})

	it('validate cookie with string constraints', async () => {
		const app = new Elysia().get(
			'/',
			({ cookie: { token } }) => token.value,
			{
				cookie: t.Cookie({
					token: t.String({ minLength: 10, maxLength: 50 })
				})
			}
		)

		const [valid, tooShort, tooLong] = await Promise.all([
			app.handle(
				req('/', {
					headers: { Cookie: 'token=validtoken123' }
				})
			),
			app.handle(
				req('/', {
					headers: { Cookie: 'token=short' }
				})
			),
			app.handle(
				req('/', {
					headers: { Cookie: 'token=' + 'a'.repeat(51) }
				})
			)
		])

		expect(valid.status).toBe(200)
		expect(tooShort.status).toBe(422)
		expect(tooLong.status).toBe(422)
	})

	it('validate cookie with numeric constraints', async () => {
		const app = new Elysia().get('/', ({ cookie: { age } }) => age.value, {
			cookie: t.Cookie({
				age: t.Numeric({ minimum: 0, maximum: 120 })
			})
		})

		const [valid, tooLow, tooHigh] = await Promise.all([
			app.handle(
				req('/', {
					headers: { Cookie: 'age=25' }
				})
			),
			app.handle(
				req('/', {
					headers: { Cookie: 'age=-1' }
				})
			),
			app.handle(
				req('/', {
					headers: { Cookie: 'age=150' }
				})
			)
		])

		expect(valid.status).toBe(200)
		expect(await valid.text()).toBe('25')
		expect(tooLow.status).toBe(422)
		expect(tooHigh.status).toBe(422)
	})

	it('validate cookie with pattern', async () => {
		const app = new Elysia().get(
			'/',
			({ cookie: { email } }) => email.value,
			{
				cookie: t.Cookie({
					email: t.String({ format: 'email' })
				})
			}
		)

		const [valid, invalid] = await Promise.all([
			app.handle(
				req('/', {
					headers: { Cookie: 'email=user@example.com' }
				})
			),
			app.handle(
				req('/', {
					headers: { Cookie: 'email=notanemail' }
				})
			)
		])

		expect(valid.status).toBe(200)
		expect(await valid.text()).toBe('user@example.com')
		expect(invalid.status).toBe(422)
	})

	it('validate cookie with transform', async () => {
		const app = new Elysia().get(
			'/',
			({ cookie: { timestamp } }) => timestamp.value,
			{
				cookie: t.Cookie({
					timestamp: t
						.Transform(t.String())
						.Decode((value) => new Date(value))
						.Encode((value) => value.toISOString())
				})
			}
		)

		const date = new Date('2024-01-01T00:00:00.000Z')
		const response = await app.handle(
			req('/', {
				headers: { Cookie: `timestamp=${date.toISOString()}` }
			})
		)

		expect(response.status).toBe(200)
	})

	it('validate optional cookie with isOptional check', async () => {
		const app = new Elysia().get(
			'/',
			({ cookie }) => {
				const keys = Object.keys(cookie)
				return keys.length > 0 ? 'has cookies' : 'no cookies'
			},
			{
				cookie: t.Optional(
					t.Cookie({
						session: t.Optional(t.String())
					})
				)
			}
		)

		const [withCookie, withoutCookie] = await Promise.all([
			app.handle(
				req('/', {
					headers: { Cookie: 'session=value' }
				})
			),
			app.handle(req('/'))
		])

		expect(withCookie.status).toBe(200)
		expect(withoutCookie.status).toBe(200)
	})

	it('validate cookie with array type', async () => {
		const app = new Elysia().get(
			'/',
			({ cookie: { tags } }) => tags.value.join(','),
			{
				cookie: t.Cookie({
					tags: t.Array(t.String())
				})
			}
		)

		const response = await app.handle(
			req('/', {
				headers: {
					Cookie:
						'tags=' +
						encodeURIComponent(
							JSON.stringify(['tag1', 'tag2', 'tag3'])
						)
				}
			})
		)

		expect(response.status).toBe(200)
		expect(await response.text()).toBe('tag1,tag2,tag3')
	})

	it('validate cookie with union type', async () => {
		const app = new Elysia().get(
			'/',
			({ cookie: { value } }) => String(value.value),
			{
				cookie: t.Cookie({
					value: t.Union([t.String(), t.Numeric()])
				})
			}
		)

		const [stringValue, numericValue, invalid] = await Promise.all([
			app.handle(
				req('/', {
					headers: { Cookie: 'value=text' }
				})
			),
			app.handle(
				req('/', {
					headers: { Cookie: 'value=123' }
				})
			),
			app.handle(
				req('/', {
					headers: {
						Cookie:
							'value=' +
							encodeURIComponent(JSON.stringify({ obj: true }))
					}
				})
			)
		])

		expect(stringValue.status).toBe(200)
		expect(numericValue.status).toBe(200)
		expect(invalid.status).toBe(422)
	})

	it('inherits cookie validation on guard', async () => {
		const app = new Elysia()
			.guard({
				cookie: t.Cookie({ session: t.String() })
			})
			.get('/', ({ cookie: { session } }) => session.value)
			.get(
				'/profile',
				({ cookie: { session } }) => `Profile: ${session.value}`
			)

		const [validRoot, validProfile, invalid] = await Promise.all([
			app.handle(
				req('/', {
					headers: { Cookie: 'session=abc123' }
				})
			),
			app.handle(
				req('/profile', {
					headers: { Cookie: 'session=abc123' }
				})
			),
			app.handle(req('/'))
		])

		expect(validRoot.status).toBe(200)
		expect(await validRoot.text()).toBe('abc123')
		expect(validProfile.status).toBe(200)
		expect(await validProfile.text()).toBe('Profile: abc123')
		expect(invalid.status).toBe(422)
	})

	it('merge cookie config from app', async () => {
		const app = new Elysia({
			cookie: {
				httpOnly: true,
				secure: true
			}
		}).get('/', ({ cookie: { session } }) => session.value ?? 'empty', {
			cookie: t.Cookie({
				session: t.Optional(t.String())
			})
		})

		const response = await app.handle(
			req('/', {
				headers: { Cookie: 'session=test' }
			})
		)

		expect(response.status).toBe(200)
		expect(await response.text()).toBe('test')
	})

	it('validate empty cookie object when optional', async () => {
		const app = new Elysia().get(
			'/',
			({ cookie }) =>
				Object.keys(cookie).length === 0 ? 'empty' : 'not empty',
			{
				cookie: t.Optional(
					t.Cookie({
						session: t.Optional(t.String())
					})
				)
			}
		)

		const response = await app.handle(req('/'))

		expect(response.status).toBe(200)
		expect(await response.text()).toBe('empty')
	})
})

	it('expires setter compares timestamps not Date objects', async () => {
		const app = new Elysia().get('/', ({ cookie: { session }, set }) => {
			// Test 1: Setting expires with same timestamp should not update
			const date1 = new Date('2025-12-31T23:59:59.000Z')
			const date2 = new Date('2025-12-31T23:59:59.000Z')
			
			session.value = 'test'
			session.expires = date1
			
			// Get reference to jar before setting with same timestamp
			const jarBefore = set.cookie
			session.expires = date2 // Same timestamp, should not update
			const jarAfter = set.cookie
			
			// Verify jar wasn't recreated (same reference)
			expect(jarBefore).toBe(jarAfter)
			expect(session.expires?.getTime()).toBe(date1.getTime())
			
			// Test 2: Setting expires with different timestamp should update
			const date3 = new Date('2026-01-01T00:00:00.000Z')
			session.expires = date3
			expect(session.expires?.getTime()).toBe(date3.getTime())
			
			// Test 3: Both undefined should not update
			session.expires = undefined
			const jarBeforeUndefined = set.cookie
			session.expires = undefined
			const jarAfterUndefined = set.cookie
			expect(jarBeforeUndefined).toBe(jarAfterUndefined)
			
			return 'ok'
		})

		const response = await app.handle(req('/'))
		expect(response.status).toBe(200)
		expect(await response.text()).toBe('ok')
	})
