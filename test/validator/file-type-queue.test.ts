import { describe, it, expect, afterAll } from 'bun:test'
import { fileTypeFromBlob } from 'file-type'

import { Elysia, t, setFileTypeDetector } from '../../src'
import { TypeBoxValidator } from '../../src/type/validator'
import { upload } from '../utils'

// restore the suite-wide detector registered in test/validator/body.test.ts
afterAll(() => {
	setFileTypeDetector(fileTypeFromBlob)
})

describe('file-type queue refinements', () => {
	it('plain t.File() stays on the sync validation path', () => {
		// no `type` option → nothing can enqueue async detection, so the
		// validator must not be forced through FromAsync
		const plain = new TypeBoxValidator(
			t.Object({ file: t.File() }) as any
		)
		expect(plain.isAsync).toBe(false)

		const typed = new TypeBoxValidator(
			t.Object({ file: t.File({ type: 'image' }) }) as any
		)
		expect(typed.isAsync).toBe(true)
	})

	it('failed content detection reports the offending property path', async () => {
		// detector reports a mime that never matches `type: 'image'`
		setFileTypeDetector(() => 'application/x-not-an-image')

		const app = new Elysia().post('/', () => 'ok', {
			body: t.Object({
				name: t.String(),
				avatar: t.File({ type: 'image' })
			})
		})

		const response = await app.handle(
			upload('/', { name: 'salt', avatar: 'fake.jpg' }).request
		)

		expect(response.status).toBe(422)
		const error = (await response.json()) as { property: string }
		expect(error.property).toBe('/avatar')
	})

	it('failed detection inside t.Files() reports the array index path', async () => {
		setFileTypeDetector(() => 'application/x-not-an-image')

		const app = new Elysia().post('/', () => 'ok', {
			body: t.Object({
				files: t.Files({ type: 'image' })
			})
		})

		const response = await app.handle(
			upload('/', { files: ['aris-yuzu.jpg', 'fake.jpg'] }).request
		)

		expect(response.status).toBe(422)
		const error = (await response.json()) as { property: string }
		expect(error.property).toMatch(/^\/files\/\d$/)
	})
})
