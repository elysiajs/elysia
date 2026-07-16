import { describe, expect, it, afterAll } from 'bun:test'
import { fileTypeFromBlob } from 'file-type'

import { Elysia, t, fileType, setFileTypeDetector } from '../../src'
import { upload } from '../utils'

// Leave the shared detector ready for later suites.
afterAll(() => {
	setFileTypeDetector(fileTypeFromBlob)
})

describe('File type detector', () => {
	it('tries detectors in order until one returns a MIME type', async () => {
		const calls: string[] = []

		setFileTypeDetector([
			() => {
				calls.push('first')
				return undefined
			},
			async () => {
				calls.push('second')
				return { mime: 'image/jpeg' }
			}
		])

		const app = new Elysia().post(
			'/',
			{
				body: t.Object({
					file: t.File({ type: 'image/jpeg' })
				})
			},
			() => 'ok'
		)

		const { request } = upload('/', { file: 'millenium.jpg' })
		const status = await app.handle(request).then((x) => x.status)

		expect(status).toBe(200)
		expect(calls).toEqual(['first', 'second'])
	})

	it('accepts a detector that returns a MIME string', async () => {
		setFileTypeDetector(() => 'image/jpeg')

		const app = new Elysia().post(
			'/',
			{
				body: t.Object({
					file: t.File({ type: 'image/jpeg' })
				})
			},
			() => 'ok'
		)

		const { request } = upload('/', { file: 'millenium.jpg' })
		const status = await app.handle(request).then((x) => x.status)

		expect(status).toBe(200)
	})

	it('rejects content that does not match the reported MIME type', async () => {
		setFileTypeDetector(() => 'text/plain')

		const app = new Elysia().post(
			'/',
			{
				body: t.Object({
					file: t.File({ type: 'image/jpeg' })
				})
			},
			() => 'ok'
		)

		const { request } = upload('/', { file: 'millenium.jpg' })
		const status = await app.handle(request).then((x) => x.status)

		expect(status).toBe(422)
	})

	it('rejects content that no detector can identify', async () => {
		setFileTypeDetector(() => undefined)

		const app = new Elysia().post(
			'/',
			{
				body: t.Object({
					file: t.File({ type: 'image/jpeg' })
				})
			},
			() => 'ok'
		)

		const { request } = upload('/', { file: 'millenium.jpg' })
		const status = await app.handle(request).then((x) => x.status)

		expect(status).toBe(422)
	})

	it('uses a detector registered after route compilation', async () => {
		setFileTypeDetector(fileTypeFromBlob)

		const app = new Elysia().post(
			'/',
			{
				body: t.Object({
					file: t.File({ type: 'image/jpeg' })
				})
			},
			() => 'ok'
		)

		{
			const { request } = upload('/', { file: 'millenium.jpg' })
			const status = await app.handle(request).then((x) => x.status)
			expect(status).toBe(200)
		}

		setFileTypeDetector(() => 'application/x-fake')

		{
			const { request } = upload('/', { file: 'millenium.jpg' })
			const status = await app.handle(request).then((x) => x.status)
			expect(status).toBe(422)
		}
	})
})

describe('fileType', () => {
	const jpg = Bun.file('test/images/millenium.jpg') as unknown as File
	const webp = Bun.file('test/images/kozeki-ui.webp') as unknown as File
	const fake = Bun.file('test/images/fake.jpg') as unknown as File

	it('matches content against exact, category, wildcard, and list types', async () => {
		setFileTypeDetector(fileTypeFromBlob)

		await expect(fileType(jpg, 'image/jpeg')).resolves.toBe(true)
		await expect(fileType(jpg, 'image')).resolves.toBe(true)
		await expect(fileType(jpg, 'image/*')).resolves.toBe(true)
		await expect(fileType(jpg, 'image/png')).resolves.toBe(false)
		await expect(fileType(jpg, ['image/png', 'image/jpeg'])).resolves.toBe(
			true
		)
		await expect(fileType(webp, ['image/png', 'image/jpeg'])).resolves.toBe(
			false
		)
	})

	it('rejects a file whose content does not match its extension', async () => {
		setFileTypeDetector(fileTypeFromBlob)

		await expect(fileType(fake, 'image/jpeg')).resolves.toBe(false)
	})

	it('requires every file in an array to match', async () => {
		setFileTypeDetector(fileTypeFromBlob)

		await expect(fileType([jpg, webp], 'image')).resolves.toBe(true)
		await expect(fileType([jpg, fake], 'image')).resolves.toBe(false)
	})

	it('returns false for a missing file', async () => {
		await expect(fileType(undefined, 'image')).resolves.toBe(false)
	})
})
