import { describe, expect, it } from 'bun:test'

import { getFileExtension, mime } from '../../src/universal/file'

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
