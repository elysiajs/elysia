import { Elysia, t, form, file } from '../../src'
import { describe, expect, it } from 'bun:test'
import { req } from '../utils'
import { formDataToObject } from '../../src/adapter/web-standard/utils'

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

// Two reported denial-of-service vectors in the multipart/form-data
// normalizer (formDataToObject). Tested against the function directly so the
// timing/termination assertions measure OUR code, not the runtime's multipart
// parse. Both are unauthenticated, reachable on any body-reading route (the
// content-type alone routes to this parser — see adapter/index.ts:37-38).
describe('Form Data DoS hardening', () => {
	// QUADRATIC: normalization called `form.getAll(key)` once per unique key,
	// and getAll is O(total entries), so n distinct keys = O(n²). A ~2MB body
	// of 500k keys pinned the worker. The fix buckets every entry in a single
	// O(n) pass while handing resolveValue the same per-key value list.
	it('normalizes a many-key form in linear time (no O(n^2) getAll)', () => {
		const form = new FormData()
		for (let i = 0; i < 100_000; i++) form.append('k' + i, 'v')

		const start = performance.now()
		const out = formDataToObject(form)
		const elapsed = performance.now() - start

		expect(out.k0).toBe('v')
		expect(out.k99999).toBe('v')
		// O(n) is tens of ms here; the O(n²) path is ~1e10 scans (minutes).
		expect(elapsed).toBeLessThan(2_000)
	})

	// UNBOUNDED LOOP: setNested scanned for a closing `]`/quote with no
	// `i < len` bound, so a key that opens a bracket/quote but never closes it
	// ran charCodeAt past the end (→ NaN, never equal to the sentinel) and
	// looped forever. A single tiny field pinned the thread. Pre-fix each of
	// these never returned.
	it('does not hang on an unterminated nested key', () => {
		for (const key of ['a[1', 'a[', "a['x", 'a["y']) {
			const form = new FormData()
			form.append(key, 'v')
			expect(() => formDataToObject(form)).not.toThrow()
		}
	})

	// Behaviour-equivalence pins for the single-pass rewrite: per-key value
	// lists, nesting, and duplicate-key arrays must match the old getAll path.
	it('preserves nested + multi-value normalization', () => {
		const form = new FormData()
		form.append('a[0]', 'x')
		form.append('a[1]', 'y')
		form.append('b.c', 'z')
		form.append('tag', '1')
		form.append('tag', '2')

		expect(formDataToObject(form)).toEqual({
			a: ['x', 'y'],
			b: { c: 'z' },
			tag: ['1', '2']
		})
	})

	// A nested key claims its root; a later plain field of the same name is
	// dropped (it does NOT overwrite the structure). This matches the old
	// getAll path's `key in body` skip — pinned because the single-pass rewrite
	// briefly regressed it to last-write-wins (plain clobbering the nested obj).
	it('a nested key wins over a colliding plain key (no clobber)', () => {
		const form = new FormData()
		form.append('user.name', 'bob')
		form.append('user', 'HAX')
		form.append('user.age', '9')
		form.append('a[0]', 'x')
		form.append('a', 'flat')
		form.append('a[1]', 'y')

		expect(formDataToObject(form)).toEqual({
			user: { name: 'bob', age: '9' },
			a: ['x', 'y']
		})
	})

	// A pathologically deep key name (e.g. `'.'.repeat(2e6)`) would otherwise
	// allocate one object per segment — hundreds of MB of heap from a few KB of
	// input. Nesting depth is capped, so a too-deep key stops descending instead
	// of amplifying. Legit shallow nesting (tested above) is unaffected.
	it('caps nesting depth on a pathologically deep key', () => {
		const form = new FormData()
		form.append('a' + '.b'.repeat(2000), 'x') // ~2001 levels

		const out = formDataToObject(form)

		let depth = 0
		let cur: any = out
		while (cur && typeof cur === 'object') {
			const k = Object.keys(cur)[0]
			if (k === undefined) break
			cur = cur[k]
			depth++
		}

		expect(depth).toBeLessThanOrEqual(70) // MAX_NESTING (64) + slack
	})

	// The per-key depth cap stops one huge key, but many medium-deep keys could
	// still aggregate into a huge heap. A global node budget bounds the TOTAL
	// objects allocated per body, so a small body can't amplify regardless of
	// how the keys are distributed.
	it('bounds total nested objects across many keys (global budget)', () => {
		const form = new FormData()
		// ~2000 distinct 63-deep keys would attempt ~126k nodes; the budget caps
		// the total around 100k.
		for (let i = 0; i < 2000; i++) form.append('r' + i + '.b'.repeat(62), 'x')

		const start = performance.now()
		const out = formDataToObject(form)
		const elapsed = performance.now() - start

		const countNodes = (o: any): number => {
			if (!o || typeof o !== 'object') return 0
			let n = 1
			for (const k in o) n += countNodes(o[k])
			return n
		}

		expect(countNodes(out)).toBeLessThanOrEqual(110_000) // ~100k cap + slack
		expect(elapsed).toBeLessThan(2_000)
	})
})
