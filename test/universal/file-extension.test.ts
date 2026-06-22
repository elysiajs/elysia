import { describe, expect, it } from 'bun:test'

import { getFileExtension, mime } from '../../src/universal/file'

// Why this matters: `getFileExtension` feeds the `mime` lookup that sets the
// `content-type` for `file(...)` responses. The `mime` table is keyed by
// lowercase extensions, so an uppercase/mixed-case path component (common on
// Windows uploads, e.g. `PHOTO.JPG`) must still resolve to the correct MIME
// type. If it doesn't, the framework silently falls back to
// `application/octet-stream`, which forces a download instead of rendering and
// is a real behavioural regression for static assets.
describe('getFileExtension', () => {
	it('lowercases the extension so MIME lookup is case-insensitive', () => {
		expect(getFileExtension('a.JPG')).toBe('jpg')
		expect(getFileExtension('photo.PNG')).toBe('png')
		expect(getFileExtension('archive.ZIP')).toBe('zip')
	})

	it('keeps already-lowercase extensions intact', () => {
		expect(getFileExtension('a.jpg')).toBe('jpg')
		expect(getFileExtension('index.html')).toBe('html')
	})

	it('returns empty string when there is no extension', () => {
		expect(getFileExtension('Makefile')).toBe('')
	})

	it('resolves the correct MIME type regardless of case', () => {
		expect(mime[getFileExtension('a.JPG') as keyof typeof mime]).toBe(
			'image/jpeg'
		)
		expect(mime[getFileExtension('a.jpg') as keyof typeof mime]).toBe(
			'image/jpeg'
		)
	})
})
