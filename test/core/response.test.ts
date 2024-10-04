import { Elysia, form, t } from '../../src'
import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

describe('Response', () => {
	it('return formdata', async () => {
		const app = new Elysia().get('/', () => {
			return form({
				a: 'hello',
				b: Bun.file('test/kyuukurarin.mp4')
			})
		})

		const contentType = await app
			.handle(req('/'))
			.then((x) => x.headers.get('content-type'))

		expect(contentType).toStartWith('multipart/form-data')
	})
})
