import { Elysia, t, form, file } from '../../src'
import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

describe('Form Data', () => {
	it('return Bun.file', async () => {
		const app = new Elysia().get('/', () =>
			form({
				a: 'hello',
				b: Bun.file('test/kyuukurarin.mp4')
			})
		)

		const contentType = await app
			.handle(req('/'))
			.then((x) => x.headers.get('content-type'))

		expect(contentType).toStartWith('multipart/form-data')
	})

	it('return Elysia.file', async () => {
		const app = new Elysia().get('/', () =>
			form({
				a: 'hello',
				b: file('test/kyuukurarin.mp4')
			})
		)

		const contentType = await app
			.handle(req('/'))
			.then((x) => x.headers.get('content-type'))

		expect(contentType).toStartWith('multipart/form-data')
	})

	it('return Elysia.file', async () => {
		const app = new Elysia().get('/', () =>
			form({
				a: 'hello',
				b: file('test/kyuukurarin.mp4')
			})
		)

		const contentType = await app
			.handle(req('/'))
			.then((x) => x.headers.get('content-type'))

		expect(contentType).toStartWith('multipart/form-data')
	})

	it('validate formdata', async () => {
		const app = new Elysia().get(
			'/',
			() =>
				form({
					a: 'hello',
					b: file('test/kyuukurarin.mp4')
				}),
			{
				response: t.Form({
					a: t.String(),
					b: t.File()
				})
			}
		)

		const response = await app.handle(req('/'))

		expect(response.status).toBe(200)
		expect(response.headers.get('content-type')).toStartWith(
			'multipart/form-data'
		)
	})

	it('return single file', async () => {
		const app = new Elysia().get('/', () => file('test/kyuukurarin.mp4'))

		const response = await app.handle(req('/'))

		expect(response.status).toBe(200)
		expect(response.headers.get('content-type')).toStartWith('video/mp4')
	})

	it('inline single file', async () => {
		const app = new Elysia().get('/', file('test/kyuukurarin.mp4'))

		const response = await app.handle(req('/'))

		expect(response.status).toBe(200)
		expect(response.headers.get('content-type')).toStartWith('video/mp4')
	})
})

// F44 — `tryParseJson` no longer speculatively `JSON.parse`s a brace/bracket-
// opened field unless it ALSO closes with the matching `}`/`]`. This removes the
// cheap-to-send / expensive-to-reject asymmetry where a `{aaaa…`-style garbage
// field paid a full failed parse (exception-as-control-flow scaling with the
// attacker-chosen length). The pinned JSON-in-multipart pattern uses
// `JSON.stringify`, whose output always ends in the matching closer, so it is
// untouched.
describe('Form Data JSON coercion (F44)', () => {
	const echo = () =>
		new Elysia().post('/', ({ body }) => body as Record<string, unknown>)

	const post = (form: FormData) =>
		echo()
			.handle(
				new Request('http://localhost/', { method: 'POST', body: form })
			)
			.then((x) => x.json())

	it('a {-opened field with no closing brace stays a string', async () => {
		const form = new FormData()
		// No closing `}` — must NOT be fed to JSON.parse, must survive as the
		// raw string rather than throwing-and-falling-back.
		form.append('payload', '{aaaa')

		expect(await post(form)).toEqual({ payload: '{aaaa' })
	})

	it('a [-opened field with no closing bracket stays a string', async () => {
		const form = new FormData()
		form.append('payload', '[1,2,3')

		expect(await post(form)).toEqual({ payload: '[1,2,3' })
	})

	it('valid JSON.stringify object/array fields still parse to objects', async () => {
		const form = new FormData()
		form.append('meta', JSON.stringify({ id: '123', altText: 'an image' }))
		form.append('list', JSON.stringify([1, 2, 3]))

		expect(await post(form)).toEqual({
			meta: { id: '123', altText: 'an image' },
			list: [1, 2, 3]
		})
	})

	it('a large valid JSON object field still parses (no length cap)', async () => {
		// The length-cap variant was rejected — large legit JSON metadata is a
		// supported pattern and must still parse, only the *unclosed* garbage is
		// skipped.
		const big = { id: '1', blob: 'x'.repeat(200_000) }
		const form = new FormData()
		form.append('meta', JSON.stringify(big))

		expect(await post(form)).toEqual({ meta: big })
	})

	it('trailing-whitespace-padded JSON now stays a string (decided behaviour)', async () => {
		// The closer-check is strict: the LAST char must be the matching closer.
		// Trailing whitespace (which the old lenient JSON.parse tolerated) is the
		// one intentional behaviour change of F44 — pinned here so a revert to
		// the unguarded parse is caught. `JSON.stringify` never emits this.
		const form = new FormData()
		form.append('payload', '{"a":1} ')

		expect(await post(form)).toEqual({ payload: '{"a":1} ' })
	})
})
