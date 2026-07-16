import { describe, it, expect } from 'bun:test'
import { Elysia, t } from '../../../src'
import { tee } from '../../../src/adapter/utils'

describe('exact content-type dispatch and schema contract', () => {
	for (const precompile of [false, true]) {
		describe(precompile ? 'precompiled' : 'default', () => {
			const request = (contentType: string, body: BodyInit) =>
				new Request('http://localhost/', {
					method: 'POST',
					headers: { 'content-type': contentType },
					body
				})

			it('does not corrupt unmatched application media types', async () => {
				const app = new Elysia({ precompile }).post('/', ({ body }) =>
					body === undefined ? 'unparsed' : typeof body
				)

				for (const [contentType, body] of [
					['application/x-ndjson', '{"ok":true}\n'],
					['application/xml', '<ok>true</ok>'],
					['application/jwt', 'token']
				] as const) {
					const response = await app.handle(
						request(contentType, body)
					)
					expect(response.status).toBe(200)
					await expect(response.text()).resolves.toBe('unparsed')
				}

				const javascript = await app.handle(
					request('text/javascript', 'const ok = true')
				)
				expect(javascript.status).toBe(200)
				await expect(javascript.text()).resolves.toBe('string')
			})

			it('returns 415 when a media type conflicts with a structured schema', async () => {
				const app = new Elysia({ precompile }).post(
					'/',
					{ body: t.Object({ ok: t.Boolean() }) },
					({ body }) => body
				)

				for (const [contentType, body] of [
					['application/x-ndjson', '{"ok":true}\n'],
					['application/xml', '<ok>true</ok>'],
					['text/javascript', '{"ok":true}'],
					['application/jwt', 'token']
				] as const)
					expect(
						(await app.handle(request(contentType, body))).status
					).toBe(415)
			})

			it('keeps absent content-type on the legacy validation path', async () => {
				const app = new Elysia({ precompile }).post(
					'/',
					{ body: t.Object({ ok: t.Boolean() }) },
					({ body }) => body
				)

				const response = await app.handle(
					new Request('http://localhost/', {
						method: 'POST',
						body: '{"ok":true}'
					})
				)
				expect(response.status).toBe(422)
			})

			it('keeps JSON, forms, bytes, and text on their exact lanes', async () => {
				const echo = new Elysia({ precompile }).post(
					'/',
					({ body }) => {
						if (body instanceof ArrayBuffer) return 'arrayBuffer'
						return body
					}
				)

				for (const contentType of [
					'application/json',
					'application/json; charset=utf-8',
					'Application/JSON; charset=UTF-8',
					'application/ld+json'
				])
					await expect(
						echo
							.handle(request(contentType, '{"ok":true}'))
							.then((x) => x.json())
					).resolves.toEqual({ ok: true })

				await expect(
					echo
						.handle(
							request(
								'application/x-www-form-urlencoded',
								'ok=true'
							)
						)
						.then((x) => x.json())
				).resolves.toEqual({ ok: 'true' })

				const form = new FormData()
				form.set('ok', 'true')
				await expect(
					echo
						.handle(
							new Request('http://localhost/', {
								method: 'POST',
								body: form
							})
						)
						.then((x) => x.json())
				).resolves.toEqual({ ok: 'true' })

				await expect(
					echo
						.handle(request('application/octet-stream', 'raw'))
						.then((x) => x.text())
				).resolves.toBe('arrayBuffer')

				await expect(
					echo
						.handle(request('text/plain', 'raw'))
						.then((x) => x.text())
				).resolves.toBe('raw')

				const structured = new Elysia({ precompile }).post(
					'/',
					{ body: t.Object({ ok: t.String() }) },
					({ body }) => body
				)
				expect(
					(
						await structured.handle(
							request(
								'application/x-www-form-urlencoded',
								'ok=true'
							)
						)
					).status
				).toBe(200)
			})

			it('accepts text for scalar schemas and keeps constraint failures at 422', async () => {
				const app = new Elysia({ precompile }).post(
					'/',
					{ body: t.String({ minLength: 3 }) },
					({ body }) => body
				)

				expect(
					(await app.handle(request('text/javascript', 'okay')))
						.status
				).toBe(200)
				expect(
					(await app.handle(request('text/javascript', 'no'))).status
				).toBe(422)
				expect(
					(await app.handle(request('application/jwt', 'token')))
						.status
				).toBe(415)

				const scalarUnion = new Elysia({ precompile }).post(
					'/',
					{ body: t.Union([t.String(), t.Boolean()]) },
					({ body }) => body
				)
				expect(
					(
						await scalarUnion.handle(
							request('application/jwt', 'token')
						)
					).status
				).toBe(415)
			})

			it('accepts only multipart and bytes for file schemas', async () => {
				const app = new Elysia({ precompile }).post(
					'/',
					{ body: t.File() },
					({ body }) => body
				)

				expect(
					(
						await app.handle(
							request('application/octet-stream', 'raw')
						)
					).status
				).not.toBe(415)

				const form = new FormData()
				form.set('file', new Blob(['raw']))
				expect(
					(
						await app.handle(
							new Request('http://localhost/', {
								method: 'POST',
								body: form
							})
						)
					).status
				).not.toBe(415)
				expect(
					(await app.handle(request('application/json', '{}'))).status
				).toBe(415)
			})

			it('fails open for custom parsers and mixed schemas', async () => {
				const custom = new Elysia({ precompile })
					.parse(({ contentType }) => {
						if (contentType === 'application/jwt')
							return { ok: true }
					})
					.post(
						'/',
						{ body: t.Object({ ok: t.Boolean() }) },
						({ body }) => body
					)

				expect(
					(await custom.handle(request('application/jwt', 'token')))
						.status
				).toBe(200)

				const mixed = new Elysia({ precompile }).post(
					'/',
					{
						body: t.Union([
							t.Object({ ok: t.Boolean() }),
							t.String()
						])
					},
					({ body }) => body
				)

				expect(
					(await mixed.handle(request('application/jwt', 'token')))
						.status
				).toBe(422)
			})
		})
	}
})

// the default content-type dispatch recognised only fixed-position
// `application/json`, so structured `+json` suffix types (RFC 6839) —
// application/ld+json, merge-patch+json, problem+json, vendor `+json` — were
// NOT routed to the JSON parser. Their bodies arrived as `undefined` and any
// schema validation failed. They must be parsed as JSON after stripping params.
describe('content-type dispatch — structured +json suffix', () => {
	const echo = () =>
		new Elysia().post('/', ({ body }) => body as Record<string, unknown>)

	const post = (contentType: string) =>
		echo()
			.handle(
				new Request('http://localhost/', {
					method: 'POST',
					headers: { 'content-type': contentType },
					body: JSON.stringify({ ok: true })
				})
			)
			.then((x) => x.json())

	for (const ct of [
		'application/ld+json',
		'application/merge-patch+json',
		'application/problem+json',
		'application/vnd.api+json',
		// parameters must be stripped before the suffix check
		'application/ld+json; charset=utf-8'
	])
		it(`parses ${ct} as JSON`, async () => {
			await expect(post(ct)).resolves.toEqual({ ok: true })
		})

	it('still parses plain application/json', async () => {
		await expect(post('application/json')).resolves.toEqual({ ok: true })
	})

	it('does not misroute a non-json application type', async () => {
		// application/octet-stream must NOT hit the JSON parser
		const body = await echo().handle(
			new Request('http://localhost/', {
				method: 'POST',
				headers: { 'content-type': 'application/octet-stream' },
				body: 'raw'
			})
		)
		// octet-stream → arrayBuffer parser, not JSON → not the echoed object
		expect(body.status).toBe(200)
	})
})

// the uppercase-multipart normalization used `new Request(request,
// {headers})`, which TEES the body — the original request stayed independently
// readable, retaining a full second copy of a potentially multi-MiB upload. The
// rewrap must transfer the body stream (no tee), leaving the original body
// disturbed/unreadable afterward.
describe('parseFormData — mixed-case multipart does not tee the body', () => {
	it('does not retain a second readable copy of the original body', async () => {
		let originalBodyStillReadable: boolean | undefined

		const app = new Elysia().post('/', ({ body }) => {
			// Not fully general across runtimes; on runtimes where the workaround
			// path fires (isBun), the original body must no longer be readable.
			return body as Record<string, unknown>
		})

		const form = new FormData()
		form.append('field', 'x'.repeat(1 << 20)) // 1MiB payload

		// Force the mixed-case content-type that triggers the normalization path.
		// FormData auto-sets a lowercase boundary content-type, so we build the
		// multipart body manually with an UPPERCASE media type.
		const boundary = '----probe'
		const payload =
			`--${boundary}\r\n` +
			`Content-Disposition: form-data; name="field"\r\n\r\n` +
			'x'.repeat(1 << 20) +
			`\r\n--${boundary}--\r\n`

		const request = new Request('http://localhost/', {
			method: 'POST',
			headers: {
				'content-type': `Multipart/Form-Data; boundary=${boundary}`
			},
			body: payload
		})

		const res = await app.handle(request)
		expect(res.status).toBe(200)
		await res.json()

		// The framework consumed the body; the original request body must be
		// disturbed (not independently re-readable). Reading it again either
		// throws or yields empty — never the full 1MiB second copy.
		try {
			const text = await request.text()
			originalBodyStillReadable = text.length > 1 << 19
		} catch {
			originalBodyStillReadable = false
		}

		expect(originalBodyStillReadable).toBe(false)
	})
})

// tee()'s byte cap charged Blobs (and unknown objects) a flat 64 bytes
// because it read `.byteLength`, which Blobs don't have. An undrained branch
// could buffer ~64 one-MiB Blobs (~64MiB) under a nominal 4MiB cap. Blobs must
// be charged `.size`; unknown objects charged conservatively (a full budget).
describe('tee() byte-cap accounting', () => {
	it('charges Blobs by .size so the byte cap actually bounds the window', async () => {
		let produced = 0
		async function* src() {
			while (true) {
				produced++
				// 1MiB blob per chunk
				yield new Blob([
					new Uint8Array(1 << 20)
				]) as unknown as Uint8Array
			}
		}

		// entry cap huge (won't trip), byte cap 4MiB → must stop after ~4 blobs
		const [client, listener] = tee(src(), 2, 1 << 20, 1 << 22)

		const drained = (async () => {
			for await (const _ of listener) {
			}
		})()

		// Pull one item from the slow client to let the producer advance at most one
		// more chunk, then yield to the microtask queue so the iterator can run.
		await client.next()
		await Promise.resolve()

		// pre-fix this raced to ~64 (64 * 64B < 4MiB); now ~4 (4 * 1MiB ≈ cap)
		expect(produced).toBeLessThanOrEqual(6)

		await client.return?.()
		await drained
	})
})
