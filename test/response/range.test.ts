import { describe, expect, it } from 'bun:test'

import { Elysia } from '../../src'
import { req } from '../utils'

// Regression test for https://github.com/elysiajs/elysia/issues/1790
// Range header was ignored; always returned bytes 0-N/N instead of the requested slice.
describe('Range header', () => {
	const content = '12345'
	const app = new Elysia().get('/file', () => new Blob([content]))

	it('returns full file without Range header', async () => {
		const res = await app.handle(req('/file'))
		expect(res.status).toBe(200)
		expect(await res.text()).toBe(content)
	})

	it('handles bytes=start- (open-ended range)', async () => {
		const res = await app.handle(
			req('/file', { headers: { range: 'bytes=3-' } })
		)
		expect(res.status).toBe(206)
		expect(res.headers.get('content-range')).toBe('bytes 3-4/5')
		expect(res.headers.get('content-length')).toBe('2')
		expect(await res.text()).toBe('45')
	})

	it('handles bytes=start-end (bounded range)', async () => {
		const res = await app.handle(
			req('/file', { headers: { range: 'bytes=1-3' } })
		)
		expect(res.status).toBe(206)
		expect(res.headers.get('content-range')).toBe('bytes 1-3/5')
		expect(res.headers.get('content-length')).toBe('3')
		expect(await res.text()).toBe('234')
	})

	it('handles bytes=-suffix (last N bytes)', async () => {
		const res = await app.handle(
			req('/file', { headers: { range: 'bytes=-2' } })
		)
		expect(res.status).toBe(206)
		expect(res.headers.get('content-range')).toBe('bytes 3-4/5')
		expect(res.headers.get('content-length')).toBe('2')
		expect(await res.text()).toBe('45')
	})

	it('clamps end beyond file size to last byte', async () => {
		const res = await app.handle(
			req('/file', { headers: { range: 'bytes=2-999' } })
		)
		expect(res.status).toBe(206)
		expect(res.headers.get('content-range')).toBe('bytes 2-4/5')
		expect(await res.text()).toBe('345')
	})

	it('returns 416 when start is out of range', async () => {
		const res = await app.handle(
			req('/file', { headers: { range: 'bytes=99-' } })
		)
		expect(res.status).toBe(416)
		expect(res.headers.get('content-range')).toBe('bytes */5')
	})
})
