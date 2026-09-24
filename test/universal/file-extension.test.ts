import { describe, expect, it } from 'bun:test'

import { ElysiaFile } from '../../src/universal/file'

describe('ElysiaFile type', () => {
	it('finds MIME types without case sensitivity', () => {
		expect(new ElysiaFile('a.JPG').type).toBe('image/jpeg')
		expect(new ElysiaFile('photo.PNG').type).toBe('image/png')
		expect(new ElysiaFile('archive.ZIP').type).toBe('application/zip')
	})

	it('falls back when the path has no known extension', () => {
		expect(new ElysiaFile('Makefile').type).toBe(
			'application/octet-stream'
		)
	})
})
