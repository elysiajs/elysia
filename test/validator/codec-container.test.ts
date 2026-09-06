import { expect, it } from 'bun:test'
import { Type } from 'typebox'
import Elysia, { t } from '../../src'
import { TypeBoxValidator } from '../../src/type/validator'

const inner = () =>
	t.ObjectString({ n: t.Numeric(), s: t.Optional(t.String()) })
const encoded = '{"n":"42","s":"keep"}'

// The same generator bug affects user-defined codecs, not just the Elysia tag.
it('preserves fields decoded by a user-defined container union', () => {
	const schema = Type.Object({
		m: Type.Union([
			Type.Object({ s: Type.Optional(Type.String()) }),
			Type.Decode(Type.String(), (value) => JSON.parse(value))
		])
	})
	const validator = new TypeBoxValidator(schema)
	expect(validator.FromSync({ m: '{"s":"keep"}' })).toEqual({
		m: { s: 'keep' }
	})
	expect(validator.FromSync({ m: '{}' })).toEqual({ m: {} })
})

it('preserves nested and referenced container fields', () => {
	const module = Type.Module({
		Inner: inner(),
		Outer: Type.Object({ m: Type.Ref('Inner') })
	})
	expect(new TypeBoxValidator(module.Outer).FromSync({ m: encoded })).toEqual(
		{
			m: { n: 42, s: 'keep' }
		}
	)
	const schema = t.Object({ m: t.ObjectString({ inner: inner() }) })
	expect(
		new TypeBoxValidator(schema).FromSync({
			m: JSON.stringify({ inner: encoded })
		})
	).toEqual({
		m: { inner: { n: 42, s: 'keep' } }
	})
})

it('preserves sanitization and unknown-field removal after decoding', async () => {
	const app = new Elysia({ sanitize: (value) => value.trim() }).post(
		'/b',
		{ body: t.Object({ m: inner() }) },
		({ body }) => body
	)
	const request = (m: string) =>
		new Request('http://localhost/b', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ m, extra: 'drop' })
		})
	const response = await app.handle(
		request('{"n":"42","s":" keep ","extra":"drop"}')
	)
	expect(response.status).toBe(200)
	await expect(response.json()).resolves.toEqual({ m: { n: 42, s: 'keep' } })
	expect((await app.handle(request('{"n":"wrong"}'))).status).toBe(422)
	expect((await app.handle(request('{broken'))).status).toBe(422)
})
