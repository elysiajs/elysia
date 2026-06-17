import { describe, expect, it, afterAll } from 'bun:test'
import { fileTypeFromBlob } from 'file-type'

import { Elysia, t, fileType, setFileTypeDetector } from '../../src'
import { upload } from '../utils'

// restore the suite-wide detector registered in test/validator/body.test.ts
afterAll(() => {
	setFileTypeDetector(fileTypeFromBlob)
})

describe('File type detector', () => {
	it('try detectors in order until one returns a mime', async () => {
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

	it('accept detector returning a mime string', async () => {
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

	it('reject when detected content does not match the reported mime', async () => {
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

		// reported mime is image/jpeg (from extension), content says otherwise
		const { request } = upload('/', { file: 'millenium.jpg' })
		const status = await app.handle(request).then((x) => x.status)

		expect(status).toBe(422)
	})

	it('reject when no detector can identify the file content', async () => {
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

	it('apply detector registered after the route is compiled', async () => {
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

		// warm up the compiled route with the current detector
		{
			const { request } = upload('/', { file: 'millenium.jpg' })
			const status = await app.handle(request).then((x) => x.status)
			expect(status).toBe(200)
		}

		// late registration must take effect without recompiling
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

	it('validate file content against expected type', async () => {
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

	it('reject spoofed file content', async () => {
		setFileTypeDetector(fileTypeFromBlob)

		// fake.jpg reports image/jpeg from its extension but contains text
		await expect(fileType(fake, 'image/jpeg')).resolves.toBe(false)
	})

	it('handle array of files', async () => {
		setFileTypeDetector(fileTypeFromBlob)

		await expect(fileType([jpg, webp], 'image')).resolves.toBe(true)
		await expect(fileType([jpg, fake], 'image')).resolves.toBe(false)
	})

	it('return false for missing file', async () => {
		await expect(fileType(undefined, 'image')).resolves.toBe(false)
	})
})
