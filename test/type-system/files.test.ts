import { Elysia, t } from '../../src'

import { describe, expect, it } from 'bun:test'

describe('Files', () => {
	const request = (...paths: string[]) => {
		const body = new FormData()
		for (const path of paths) body.append('file', Bun.file(path))

		return new Request('http://localhost/', {
			method: 'POST',
			body
		})
	}

	const itemCountApp = new Elysia().post(
		'/',
		{
			body: t.Object({
				file: t.Files({
					minItems: 2,
					maxItems: 2
				})
			})
		},
		() => 'ok'
	)

	it('rejects fewer files than minItems', async () => {
		const response = await itemCountApp.handle(
			request('test/images/millenium.jpg')
		)

		expect(response.status).toBe(422)
	})

	it('accepts a file count within minItems and maxItems', async () => {
		const response = await itemCountApp.handle(
			request('test/images/millenium.jpg', 'test/images/kozeki-ui.webp')
		)

		expect(response.status).toBe(200)
	})

	it('rejects more files than maxItems', async () => {
		const response = await itemCountApp.handle(
			request(
				'test/images/millenium.jpg',
				'test/images/kozeki-ui.webp',
				'test/images/midori.png'
			)
		)

		expect(response.status).toBe(422)
	})

	const fileSizeApp = new Elysia().post(
		'/',
		{
			body: t.Object({
				file: t.Files({
					maxSize: '100k'
				})
			})
		},
		() => 'ok'
	)

	it('rejects an item larger than maxSize', async () => {
		const response = await fileSizeApp.handle(
			request('test/images/millenium.jpg', 'test/images/kozeki-ui.webp')
		)

		expect(response.status).toBe(422)
	})

	it('accepts every item within maxSize', async () => {
		const response = await fileSizeApp.handle(
			request('test/images/kozeki-ui.webp')
		)

		expect(response.status).toBe(200)
	})

	it('decodes a File in the selected union branch', async () => {
		const app = new Elysia().post(
			'/',
			{
				body: t.Union([
					t.Object({
						avatar: t.File(),
						type: t.Literal('image')
					}),
					t.Object({
						document: t.File(),
						type: t.Literal('doc')
					})
				])
			},
			({ body }) => 'ok'
		)

		const body = new FormData()
		body.append('avatar', Bun.file('test/images/millenium.jpg'))
		body.append('type', 'image')

		const response = await app.handle(
			new Request('http://localhost/', {
				method: 'POST',
				body
			})
		)

		expect(response.status).toBe(200)
	})

	it('decodes Files in the selected union branch', async () => {
		const app = new Elysia().post(
			'/',
			{
				body: t.Union([
					t.Object({
						images: t.Files(),
						category: t.Literal('gallery')
					}),
					t.Object({
						documents: t.Files(),
						category: t.Literal('archive')
					})
				])
			},
			({ body }) => 'ok'
		)

		const body = new FormData()
		body.append('images', Bun.file('test/images/millenium.jpg'))
		body.append('images', Bun.file('test/images/kozeki-ui.webp'))
		body.append('category', 'gallery')

		const response = await app.handle(
			new Request('http://localhost/', {
				method: 'POST',
				body
			})
		)

		expect(response.status).toBe(200)
	})
})
