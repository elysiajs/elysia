import { describe, expect, it, afterAll, spyOn } from 'bun:test'
import { fileTypeFromBlob } from 'file-type'

import { Elysia, t, fileType, setFileTypeDetector } from '../../src'
import {
	isAsyncPredicate,
	MAX_QUEUED_FILE_TYPE_CHECKS
} from '../../src/type/elysia/file-type'
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

/**
 * A fresh copy of the module, so its process-wide detector and its one-shot
 * warn latch both start empty no matter what earlier suites configured.
 * Deliberately not the shared instance: `setFileTypeDetector` has no "unset",
 * and clobbering the shared detector would break the rest of the suite.
 */
const fileTypeModulePath = '../../src/type/elysia/file-type'
let freshCount = 0
const freshFileTypeModule = () =>
	import(`${fileTypeModulePath}?no-detector=${++freshCount}`) as Promise<
		typeof import('../../src/type/elysia/file-type')
	>

/** what `t.File({ type })` hands the queue for a slot without `maxItems` */
const freshBudget = () => ({
	epoch: -1,
	count: 0,
	limit: MAX_QUEUED_FILE_TYPE_CHECKS
})

describe('missing file type detector', () => {
	const jpg = Bun.file('test/images/millenium.jpg') as unknown as File
	const message = 'Expect file type to be image'

	it('warns which call is missing on the fileType() lane', async () => {
		const { fileType } = await freshFileTypeModule()
		const warn = spyOn(console, 'warn').mockImplementation(() => {})

		let warned: string[]
		try {
			// a genuine JPEG: without the warn the caller is told their own
			// valid file is not an image, with nothing naming the real cause
			await expect(fileType(jpg, 'image')).resolves.toBe(false)
			warned = warn.mock.calls.map((call) => call.join(' '))
		} finally {
			warn.mockRestore()
		}

		expect(warned).toHaveLength(1)
		expect(warned[0]).toContain('file type detector')
		expect(warned[0]).toStartWith('[elysia]')
	})

	it('warns on the queued lane that t.File({ type }) takes', async () => {
		// t.File({ type }) is an async refine, so it never reaches fileType();
		// it queues through maybeQueueFileTypeCheck instead
		expect(
			isAsyncPredicate((t.File({ type: 'image' }) as any)['~refine'])
		).toBe(true)

		const {
			collectFileTypeChecks,
			maybeQueueFileTypeCheck,
			takeFileTypeChecks
		} = await freshFileTypeModule()
		const warn = spyOn(console, 'warn').mockImplementation(() => {})

		let warned: string[]
		let pending: ReturnType<typeof takeFileTypeChecks>
		try {
			collectFileTypeChecks()
			maybeQueueFileTypeCheck(jpg, ['image'], message, freshBudget())
			pending = takeFileTypeChecks()
			warned = warn.mock.calls.map((call) => call.join(' '))
		} finally {
			warn.mockRestore()
		}

		// diagnostic only: the queued failure is byte-identical to before
		await expect(pending![0].check).resolves.toBe(message)

		expect(warned).toHaveLength(1)
		expect(warned[0]).toContain('file type detector')
	})

	it('stays silent once a detector is configured', async () => {
		const module = await freshFileTypeModule()
		module.setFileTypeDetector(fileTypeFromBlob)

		const warn = spyOn(console, 'warn').mockImplementation(() => {})

		let warned: string[]
		try {
			await expect(module.fileType(jpg, 'image')).resolves.toBe(true)

			module.collectFileTypeChecks()
			module.maybeQueueFileTypeCheck(
				jpg,
				['image'],
				message,
				freshBudget()
			)
			await Promise.all(
				(module.takeFileTypeChecks() ?? []).map((x) => x.check)
			)

			warned = warn.mock.calls.map((call) => call.join(' '))
		} finally {
			warn.mockRestore()
		}

		expect(warned).toEqual([])
	})

	it('warns once per process, not once per file', async () => {
		const module = await freshFileTypeModule()
		const warn = spyOn(console, 'warn').mockImplementation(() => {})

		let warned: string[]
		try {
			await module.fileType(jpg, 'image')
			await module.fileType(jpg, 'image')

			module.collectFileTypeChecks()
			module.maybeQueueFileTypeCheck(
				jpg,
				['image'],
				message,
				freshBudget()
			)
			module.takeFileTypeChecks()

			warned = warn.mock.calls.map((call) => call.join(' '))
		} finally {
			warn.mockRestore()
		}

		// one warn covering both lanes: a per-upload log would be worse than
		// the silence it replaces
		expect(warned).toHaveLength(1)
	})
})
