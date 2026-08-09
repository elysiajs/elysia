import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { fileTypeFromBlob } from 'file-type'

import { Elysia, t, setFileTypeDetector } from '../../src'
import { TypeBoxValidator } from '../../src/type/validator'
import { MAX_QUEUED_FILE_TYPE_CHECKS } from '../../src/type/elysia/file-type'
import { upload } from '../utils'

// Typed file schemas require a detector when they are constructed.
beforeAll(() => {
	setFileTypeDetector(fileTypeFromBlob)
})

// Restore the detector used by the rest of the validator suite.
afterAll(() => {
	setFileTypeDetector(fileTypeFromBlob)
})

describe('file-type queue refinements', () => {
	it('plain t.File() stays on the sync validation path', () => {
		const plain = new TypeBoxValidator(t.Object({ file: t.File() }) as any)
		expect(plain.isAsync).toBe(false)

		const typed = new TypeBoxValidator(
			t.Object({ file: t.File({ type: 'image' }) }) as any
		)
		expect(typed.isAsync).toBe(true)
	})

	it('failed content detection reports the offending property path', async () => {
		setFileTypeDetector(() => 'application/x-not-an-image')

		const app = new Elysia().post(
			'/',
			{
				body: t.Object({
					name: t.String(),
					avatar: t.File({ type: 'image' })
				})
			},
			() => 'ok'
		)

		const response = await app.handle(
			upload('/', { name: 'salt', avatar: 'fake.jpg' }).request
		)

		expect(response.status).toBe(422)
		const error = (await response.json()) as { property: string }
		expect(error.property).toBe('/avatar')
	})

	// Detection reads bytes off every file (`Blob.slice().arrayBuffer()`), and
	// `maxItems` is a refine on the outer array — it only rejects *after* every
	// item has been visited. An attacker therefore pays ~150 bytes of multipart
	// per detector, which is a remote resource amplifier unless the declared
	// bound gates the fan-out itself
	it('runs no more detections than the declared maxItems', async () => {
		let calls = 0
		setFileTypeDetector(() => {
			calls++
			return 'image/jpeg'
		})

		const app = new Elysia().post(
			'/',
			{ body: t.Object({ files: t.Files({ type: 'image', maxItems: 2 }) }) },
			() => 'ok'
		)

		const body = new FormData()
		for (let i = 0; i < 300; i++)
			body.append('files', Bun.file('./test/images/aris-yuzu.jpg'))

		const response = await app.handle(
			new Request('http://localhost/', { method: 'POST', body })
		)

		expect(response.status).toBe(422)
		expect(calls).toBeLessThanOrEqual(2)
	})

	it('keeps detecting every file a valid request declares', async () => {
		let calls = 0
		setFileTypeDetector(() => {
			calls++
			return 'image/jpeg'
		})

		const app = new Elysia().post(
			'/',
			{ body: t.Object({ files: t.Files({ type: 'image', maxItems: 2 }) }) },
			({ body }) => String(body.files.length)
		)

		// twice: the budget is per validation pass, not per schema lifetime
		for (let round = 0; round < 2; round++) {
			calls = 0

			const body = new FormData()
			body.append('files', Bun.file('./test/images/aris-yuzu.jpg'))
			body.append('files', Bun.file('./test/images/millenium.jpg'))

			const response = await app.handle(
				new Request('http://localhost/', { method: 'POST', body })
			)

			expect(response.status).toBe(200)
			expect(calls).toBe(2)
		}
	})

	// Without a declared bound the fan-out is still linear in upload count, so
	// a default ceiling is the only thing standing between one request and
	// 10^5 detector invocations
	it('caps detector fan-out when no maxItems is declared', async () => {
		let calls = 0
		setFileTypeDetector(() => {
			calls++
			return 'image/jpeg'
		})

		const app = new Elysia().post(
			'/',
			{ body: t.Object({ files: t.Files({ type: 'image' }) }) },
			() => 'ok'
		)

		const body = new FormData()
		for (let i = 0; i < MAX_QUEUED_FILE_TYPE_CHECKS + 200; i++)
			body.append('files', Bun.file('./test/images/aris-yuzu.jpg'))

		const response = await app.handle(
			new Request('http://localhost/', { method: 'POST', body })
		)

		// a validation error, not a crash
		expect(response.status).toBe(422)
		expect(calls).toBe(MAX_QUEUED_FILE_TYPE_CHECKS)

		const error = (await response.json()) as {
			property: string
			detail: string
		}
		expect(error.property).toBe(`/files/${MAX_QUEUED_FILE_TYPE_CHECKS}`)
		expect(error.detail).toContain(String(MAX_QUEUED_FILE_TYPE_CHECKS))
	})

	// the budget is per slot: one field's uploads must not eat another's.
	// A single shared 64-budget can't be told apart from a per-slot one by a
	// legitimate 1+2 split alone (3 calls is under 64 either way), so this
	// also drives `gallery`'s own small budget past its limit while `avatar`
	// separately spends its own (larger, default) budget: if the two slots
	// shared one counter, avatar's call would count against gallery's limit
	// (or gallery's overflow would count against avatar's), and the
	// `calls` tally below would no longer match a per-slot accounting
	it('budgets each typed file slot independently', async () => {
		let calls = 0
		setFileTypeDetector(() => {
			calls++
			return 'image/jpeg'
		})

		const app = new Elysia().post(
			'/',
			{
				body: t.Object({
					avatar: t.File({ type: 'image' }),
					gallery: t.Files({ type: 'image', maxItems: 2 })
				})
			},
			() => 'ok'
		)

		const body = new FormData()
		body.append('avatar', Bun.file('./test/images/aris-yuzu.jpg'))
		body.append('gallery', Bun.file('./test/images/aris-yuzu.jpg'))
		body.append('gallery', Bun.file('./test/images/millenium.jpg'))

		const response = await app.handle(
			new Request('http://localhost/', { method: 'POST', body })
		)

		// a legitimate multi-slot request: one avatar + a full gallery must
		// not have one field's upload count eat into the other's allowance
		expect(response.status).toBe(200)
		expect(calls).toBe(3)

		// now drive `gallery`'s own budget (maxItems: 1) past its limit
		// while `avatar` separately consumes its own, unrelated budget
		calls = 0
		const strictApp = new Elysia().post(
			'/',
			{
				body: t.Object({
					avatar: t.File({ type: 'image' }),
					gallery: t.Files({ type: 'image', maxItems: 1 })
				})
			},
			() => 'ok'
		)

		const overBudget = new FormData()
		overBudget.append('avatar', Bun.file('./test/images/aris-yuzu.jpg'))
		overBudget.append('gallery', Bun.file('./test/images/aris-yuzu.jpg'))
		overBudget.append('gallery', Bun.file('./test/images/millenium.jpg'))
		overBudget.append('gallery', Bun.file('./test/images/aris-yuzu.jpg'))

		const overResponse = await strictApp.handle(
			new Request('http://localhost/', { method: 'POST', body: overBudget })
		)

		expect(overResponse.status).toBe(422)
		// gallery's own budget (limit 1) stops detecting after its first
		// file no matter how many detections avatar's separate budget
		// already made: avatar(1) + gallery(1, then over-budget) = 2. A
		// budget shared across slots would let all 3 gallery files through
		// too (well under a shared 64 cap) and read 4 here instead
		expect(calls).toBe(2)
	})

	it('failed detection inside t.Files() reports the array index path', async () => {
		setFileTypeDetector(() => 'application/x-not-an-image')

		const app = new Elysia().post(
			'/',
			{
				body: t.Object({
					files: t.Files({ type: 'image' })
				})
			},
			() => 'ok'
		)

		const response = await app.handle(
			upload('/', { files: ['aris-yuzu.jpg', 'fake.jpg'] }).request
		)

		expect(response.status).toBe(422)
		const error = (await response.json()) as { property: string }
		expect(error.property).toMatch(/^\/files\/\d$/)
	})
})
