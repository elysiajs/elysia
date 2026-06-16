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

		const app = new Elysia().post('/', () => 'ok', {
			body: t.Object({
				file: t.File({ type: 'image/jpeg' })
			})
		})

		const { request } = upload('/', { file: 'millenium.jpg' })
		const status = await app.handle(request).then((x) => x.status)

		expect(status).toBe(200)
		expect(calls).toEqual(['first', 'second'])
	})

	it('accept detector returning a mime string', async () => {
		setFileTypeDetector(() => 'image/jpeg')

		const app = new Elysia().post('/', () => 'ok', {
			body: t.Object({
				file: t.File({ type: 'image/jpeg' })
			})
		})

		const { request } = upload('/', { file: 'millenium.jpg' })
		const status = await app.handle(request).then((x) => x.status)

		expect(status).toBe(200)
	})

	it('reject when detected content does not match the reported mime', async () => {
		setFileTypeDetector(() => 'text/plain')

		const app = new Elysia().post('/', () => 'ok', {
			body: t.Object({
				file: t.File({ type: 'image/jpeg' })
			})
		})

		// reported mime is image/jpeg (from extension), content says otherwise
		const { request } = upload('/', { file: 'millenium.jpg' })
		const status = await app.handle(request).then((x) => x.status)

		expect(status).toBe(422)
	})

	it('reject when no detector can identify the file content', async () => {
		setFileTypeDetector(() => undefined)

		const app = new Elysia().post('/', () => 'ok', {
			body: t.Object({
				file: t.File({ type: 'image/jpeg' })
			})
		})

		const { request } = upload('/', { file: 'millenium.jpg' })
		const status = await app.handle(request).then((x) => x.status)

		expect(status).toBe(422)
	})

	it('apply detector registered after the route is compiled', async () => {
		setFileTypeDetector(fileTypeFromBlob)

		const app = new Elysia().post('/', () => 'ok', {
			body: t.Object({
				file: t.File({ type: 'image/jpeg' })
			})
		})

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

		expect(await fileType(jpg, 'image/jpeg')).toBe(true)
		expect(await fileType(jpg, 'image')).toBe(true)
		expect(await fileType(jpg, 'image/*')).toBe(true)
		expect(await fileType(jpg, 'image/png')).toBe(false)
		expect(await fileType(jpg, ['image/png', 'image/jpeg'])).toBe(true)
		expect(await fileType(webp, ['image/png', 'image/jpeg'])).toBe(false)
	})

	it('reject spoofed file content', async () => {
		setFileTypeDetector(fileTypeFromBlob)

		// fake.jpg reports image/jpeg from its extension but contains text
		expect(await fileType(fake, 'image/jpeg')).toBe(false)
	})

	it('handle array of files', async () => {
		setFileTypeDetector(fileTypeFromBlob)

		expect(await fileType([jpg, webp], 'image')).toBe(true)
		expect(await fileType([jpg, fake], 'image')).toBe(false)
	})

	it('return false for missing file', async () => {
		expect(await fileType(undefined, 'image')).toBe(false)
	})
})
