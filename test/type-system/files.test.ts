import { Elysia, t, ValidationError } from '../../src'

import { describe, expect, it } from 'bun:test'
import { post, upload } from '../utils'

describe('Files', () => {
	it('validate minItems, maxItems', async () => {
		const app = new Elysia().post('/', () => 'ok', {
			body: t.Object({
				file: t.Files({
					minItems: 2,
					maxItems: 2
				})
			})
		})

		// case 1 fail: less than 2 files
		{
			const body = new FormData()
			body.append('file', Bun.file('test/images/millenium.jpg'))

			const response = await app.handle(
				new Request('http://localhost/', {
					method: 'POST',
					body
				})
			)

			expect(response.status).toBe(422)
		}

		// case 2 pass: all valid images
		{
			const body = new FormData()
			body.append('file', Bun.file('test/images/millenium.jpg'))
			body.append('file', Bun.file('test/images/kozeki-ui.webp'))

			const response = await app.handle(
				new Request('http://localhost/', {
					method: 'POST',
					body
				})
			)

			expect(response.status).toBe(200)
		}

		// case 3 fail: more than 2 files
		{
			const body = new FormData()
			body.append('file', Bun.file('test/images/millenium.jpg'))
			body.append('file', Bun.file('test/images/kozeki-ui.webp'))
			body.append('file', Bun.file('test/images/midori.png'))

			const response = await app.handle(
				new Request('http://localhost/', {
					method: 'POST',
					body
				})
			)

			expect(response.status).toBe(422)
		}
	})
})
