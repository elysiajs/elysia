import { describe, it, expect } from 'bun:test'
import { mapResponse } from '../../../src/adapter/web-standard/handler'
import { skipClone } from '../../../src/adapter/skip-clone'

describe('mapResponse — Response pass-through', () => {
	it('returns a Response by reference when set is untouched', () => {
		const original = new Response('hi')
		expect(mapResponse(original, { headers: {} } as any)).toBe(original)
	})

	it('returns a new Response when set.status changes', () => {
		const original = new Response('hi')
		const res = mapResponse(original, { headers: {}, status: 201 } as any)
		expect(res).not.toBe(original)
		expect(res.status).toBe(201)
	})

	it('applies set.headers without mutating the original Response', () => {
		const original = new Response('hi')
		const res = mapResponse(original, {
			headers: { 'x-add': '1' }
		} as any)
		expect(res).not.toBe(original)
		expect(res.headers.get('x-add')).toBe('1')
		expect(original.headers.get('x-add')).toBeNull()
	})
})

describe('mapResponse — no-op set pass-through', () => {
	it('passes a Response through by reference when set.status matches', () => {
		const original = new Response('error', { status: 422 })
		const res = mapResponse(original, {
			headers: {},
			status: 422
		} as any)
		expect(res).toBe(original)
	})

	it('returns a new Response when cookies are set', () => {
		const original = new Response('error', { status: 422 })
		const res = mapResponse(original, {
			headers: {},
			status: 422,
			cookie: { name: { value: 'hina' } }
		} as any)
		expect(res).not.toBe(original)
		expect(res.status).toBe(422)
		expect(res.headers.getAll('set-cookie')).toEqual(['name=hina'])
	})
})

describe('mapResponse — header merge', () => {
	it('response headers win over set.headers on the merged clone', () => {
		const original = new Response('hi', {
			headers: { 'x-a': 'response' }
		})
		const res = mapResponse(original, {
			headers: { 'x-a': 'set', 'x-b': 'set' }
		} as any)
		expect(res).not.toBe(original)
		expect(res.headers.get('x-a')).toBe('response')
		expect(res.headers.get('x-b')).toBe('set')
		expect(original.headers.get('x-b')).toBeNull()
	})

	it('returns a new Response when set.headers contains Set-Cookie', () => {
		const original = new Response('hi')
		const res = mapResponse(original, {
			headers: { 'set-cookie': 'a=b' }
		} as any)
		expect(res).not.toBe(original)
		expect(res.headers.getAll('set-cookie')).toEqual(['a=b'])
		expect(original.headers.get('set-cookie')).toBeNull()
	})
})

describe('mapResponse — Response and framework cookie union', () => {
	for (const count of [0, 1, 2, 3])
		it(`preserves the Response cookie with ${count} framework cookies`, () => {
			const original = new Response('hi', {
				headers: { 'set-cookie': 'origin=1' }
			})
			const cookie = Object.fromEntries(
				Array.from({ length: count }, (_, index) => [
					`framework${index}`,
					{ value: String(index) }
				])
			)
			const res = mapResponse(original, {
				headers: {},
				...(count ? { cookie } : {})
			} as any)

			expect(res.headers.getSetCookie()).toEqual([
				'origin=1',
				...Array.from(
					{ length: count },
					(_, index) => `framework${index}=${index}`
				)
			])
			expect(original.headers.getSetCookie()).toEqual(['origin=1'])
		})

	it('does not duplicate an exact cookie when a mapped Response is mapped again', () => {
		const set = {
			headers: new Headers({ 'set-cookie': 'framework=1' })
		} as any
		const once = mapResponse(
			new Response('hi', {
				headers: { 'set-cookie': 'origin=1' }
			}),
			set
		)
		const twice = mapResponse(once, set)

		expect(twice.headers.getSetCookie()).toEqual([
			'origin=1',
			'framework=1'
		])
	})
})

describe('mapResponse — shared Response body reuse', () => {
	it('preserves the body across repeated mappings', async () => {
		const shared = new Response('hello', {
			headers: { 'content-type': 'text/plain' }
		})

		for (let n = 1; n <= 3; n++) {
			const res = mapResponse(shared, {
				headers: { 'x-req': String(n) }
			} as any) as Response

			await expect(res.text()).resolves.toBe('hello')
			expect(res.status).toBe(200)
			expect(res.headers.get('content-type')).toBe('text/plain')
			expect(res.headers.get('x-req')).toBe(String(n))
		}

		await expect(shared.clone().text()).resolves.toBe('hello')
		expect(shared.headers.get('x-req')).toBeNull()
	})
})

describe('mapResponse — Response body ownership', () => {
	const makeCountedStream = (chunks: number, size: number) => {
		const counter = { pulled: 0 }
		const stream = new ReadableStream({
			pull(controller) {
				if (counter.pulled >= chunks) return controller.close()
				counter.pulled++
				controller.enqueue(new Uint8Array(size))
			}
		})
		return { stream, counter }
	}

	const drain = async (res: Response) => {
		const reader = res.body!.getReader()
		for (;;) {
			const { done } = await reader.read()
			if (done) break
		}
	}

	it('does not retain a second body copy for a marked response', async () => {
		const { stream, counter } = makeCountedStream(8, 1 << 16)
		const response = new Response(stream, {
			headers: { 'content-type': 'application/octet-stream' }
		})
		skipClone.add(response)

		const mapped = mapResponse(response, {
			headers: { 'x-add': '1' }
		} as any) as Response

		expect(mapped).not.toBe(response)
		expect(mapped.headers.get('x-add')).toBe('1')

		await drain(mapped)

		expect(counter.pulled).toBe(8)
		expect(response.bodyUsed).toBe(true)
	})

	it('preserves an unmarked Response for reuse', async () => {
		const shared = new Response('hello', {
			headers: { 'content-type': 'text/plain' }
		})

		const mapped = mapResponse(shared, {
			headers: { 'x-add': '1' }
		} as any) as Response

		await expect(mapped.text()).resolves.toBe('hello')
		await expect(shared.clone().text()).resolves.toBe('hello')
	})
})

describe('mapResponse — shared chunked Response reuse', () => {
	it('streams a shared chunked Response across repeated requests', async () => {
		const shared = new Response(new TextEncoder().encode('shared-chunk'), {
			headers: { 'transfer-encoding': 'chunked' }
		})

		const read = async (res: Response) => {
			const reader = res.body!.getReader()
			const dec = new TextDecoder()
			let out = ''
			for (;;) {
				const { done, value } = await reader.read()
				if (done) break
				out += typeof value === 'string' ? value : dec.decode(value)
			}
			return out
		}

		for (let n = 1; n <= 3; n++) {
			const res = (await mapResponse(shared, {
				headers: { 'x-req': String(n) }
			} as any)) as Response

			expect(res.headers.get('transfer-encoding')).toBe('chunked')
			expect(res.headers.get('x-req')).toBe(String(n))
			await expect(read(res)).resolves.toBe('shared-chunk')
		}
	})
})
