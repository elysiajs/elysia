import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { fileTypeFromBlob } from 'file-type'

import { Elysia, t, setFileTypeDetector } from '../../src'
import { TypeBoxValidator } from '../../src/type/validator'
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
