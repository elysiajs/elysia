import { describe, it, expect } from 'bun:test'

import { handleFile, responseToSetHeaders } from '../../src/adapter/utils'

describe('file response range headers', () => {
	it('applies accept-ranges/content-range defaults when absent', () => {
		const body = new Blob(['12345'])
		const res = handleFile(body, {
			headers: new Headers({ 'x-custom': 'a' }),
			status: 200,
			cookie: undefined
		} as any)

		expect(res.headers.get('accept-ranges')).toBe('bytes')
		expect(res.headers.get('content-range')).toBe('bytes 0-4/5')
		expect(res.headers.get('x-custom')).toBe('a')
	})

	it('does not override a user-provided range header', () => {
		const body = new Blob(['12345'])
		const res = handleFile(body, {
			headers: new Headers({ 'accept-ranges': 'none' }),
			status: 200,
			cookie: undefined
		} as any)

		expect(res.headers.get('accept-ranges')).toBe('none')
	})
})

describe('streaming response headers', () => {
	it('removes content-encoding when set.headers is a Headers instance', () => {
		const set = {
			headers: new Headers({
				'content-encoding': 'gzip',
				'content-type': 'text/plain'
			}),
			status: 200
		}

		const out = responseToSetHeaders(new Response('hi'), set as any)

		const read = (key: string) =>
			out.headers instanceof Headers
				? out.headers.get(key)
				: (out.headers as Record<string, string>)[key]

		expect(read('content-encoding') ?? null).toBeNull()
		expect(read('content-type')).toBe('text/plain')
	})

	it('still removes content-encoding on a plain-object set.headers', () => {
		const set = {
			headers: { 'content-encoding': 'gzip' } as Record<string, string>,
			status: 200
		}

		const out = responseToSetHeaders(new Response('hi'), set as any)

		expect(
			(out.headers as Record<string, string>)['content-encoding']
		).toBeUndefined()
	})
})
