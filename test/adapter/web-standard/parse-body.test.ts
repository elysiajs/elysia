import { describe, it, expect } from 'bun:test'
import { Elysia } from '../../../src'
import { tee } from '../../../src/adapter/utils'

// H13c: the default content-type dispatch recognised only fixed-position
// `application/json`, so structured `+json` suffix types (RFC 6839) —
// application/ld+json, merge-patch+json, problem+json, vendor `+json` — were
// NOT routed to the JSON parser. Their bodies arrived as `undefined` and any
// schema validation failed. They must be parsed as JSON after stripping params.
describe('content-type dispatch — structured +json suffix (H13c)', () => {
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

// H02a: the uppercase-multipart normalization used `new Request(request,
// {headers})`, which TEES the body — the original request stayed independently
// readable, retaining a full second copy of a potentially multi-MiB upload. The
// rewrap must transfer the body stream (no tee), leaving the original body
// disturbed/unreadable afterward.
describe('parseFormData — mixed-case multipart does not tee the body (H02a)', () => {
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

// H02b: tee()'s byte cap charged Blobs (and unknown objects) a flat 64 bytes
// because it read `.byteLength`, which Blobs don't have. An undrained branch
// could buffer ~64 one-MiB Blobs (~64MiB) under a nominal 4MiB cap. Blobs must
// be charged `.size`; unknown objects charged conservatively (a full budget).
describe('tee() byte-cap accounting (H02b)', () => {
	it('charges Blobs by .size so the byte cap actually bounds the window', async () => {
		let produced = 0
		async function* src() {
			while (true) {
				produced++
				// 1MiB blob per chunk
				yield new Blob([new Uint8Array(1 << 20)]) as unknown as Uint8Array
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
