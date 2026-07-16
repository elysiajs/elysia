import { mime } from '../../src/universal/file'

import { describe, expect, it } from 'bun:test'

describe('MIME types', () => {
	it('never contain a double slash', () => {
		for (const [ext, value] of Object.entries(mime))
			expect(value, `mime[${ext}]`).not.toContain('//')
	})

	it('maps common application extensions', () => {
		expect(mime.json).toBe('application/json')
		expect(mime.js).toBe('application/javascript')
		expect(mime.xml).toBe('application/xml')
		expect(mime.pdf).toBe('application/pdf')
		expect(mime.zip).toBe('application/zip')
		expect(mime.doc).toBe('application/msword')
	})
})
