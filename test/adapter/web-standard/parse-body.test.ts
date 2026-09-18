import { describe, it, expect } from 'bun:test'
import { Elysia, t } from '../../../src'

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

describe('content-type normalization', () => {
	it('passes the bare media type to custom parsers', async () => {
		let seen: string | undefined
		const app = new Elysia().post(
			'/',
			{
				parse: ({ contentType, request }) => {
					seen = contentType
					if (contentType === 'application/json')
						return request.json()
				}
			},
			({ body }) => body
		)

		const response = await app.handle(
			new Request('http://localhost/', {
				method: 'POST',
				headers: { 'content-type': 'application/json; charset=utf-8' },
				body: '{"ok":true}'
			})
		)

		expect(seen).toBe('application/json')
		expect(response.status).toBe(200)
		await expect(response.json()).resolves.toEqual({ ok: true })
	})
})

describe('structured +json content types', () => {
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
		'application/ld+json; charset=utf-8'
	])
		it(`parses ${ct} as JSON`, async () => {
			await expect(post(ct)).resolves.toEqual({ ok: true })
		})

	it('still parses plain application/json', async () => {
		await expect(post('application/json')).resolves.toEqual({ ok: true })
	})

	it('does not parse application/octet-stream as JSON', async () => {
		const body = await echo().handle(
			new Request('http://localhost/', {
				method: 'POST',
				headers: { 'content-type': 'application/octet-stream' },
				body: 'raw'
			})
		)
		expect(body.status).toBe(200)
	})
})

describe('mixed-case multipart body handling', () => {
	it('consumes the original request body without retaining a tee', async () => {
		let originalBodyStillReadable: boolean | undefined

		const app = new Elysia().post(
			'/',
			({ body }) => body as Record<string, unknown>
		)
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

		try {
			const text = await request.text()
			originalBodyStillReadable = text.length > 1 << 19
		} catch {
			originalBodyStillReadable = false
		}

		expect(originalBodyStillReadable).toBe(false)
	})
})
