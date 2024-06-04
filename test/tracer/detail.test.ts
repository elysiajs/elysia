import { Elysia } from '../../src'
import { describe, expect, it } from 'bun:test'
import { post, req } from '../utils'

describe('Trace Detail', async () => {
	it('report parse units name', async () => {
		const app = new Elysia()
			.trace(({ onParse, set }) => {
				onParse(({ children, onStop }) => {
					const names = <string[]>[]

					for (const child of children)
						child(({ name }) => {
							names.push(name)
						})

					onStop(() => {
						set.headers.name = names.join(', ')
					})
				})
			})
			.onParse(function luna() {})
			.post('/', ({ body }) => body, {
				parse: [function kindred() {}]
			})

		const { headers } = await app.handle(post('/', {}))

		expect(headers.get('name')).toBe('luna, kindred')
	})

	it('report transform units name', async () => {
		const app = new Elysia()
			.trace(({ onTransform, set }) => {
				onTransform(({ children, onStop }) => {
					const names = <string[]>[]

					for (const child of children)
						child(({ name }) => {
							names.push(name)
						})

					onStop(() => {
						set.headers.name = names.join(', ')
					})
				})
			})
			.onTransform(function luna() {})
			.get('/', () => 'a', {
				transform: [function kindred() {}]
			})

		const { headers } = await app.handle(req('/'))

		expect(headers.get('name')).toBe('luna, kindred')
	})

	it('report beforeHandle units name', async () => {
		const app = new Elysia()
			.trace(({ onBeforeHandle, set }) => {
				onBeforeHandle(({ children, onStop }) => {
					const names = <string[]>[]

					for (const child of children)
						child(({ name }) => {
							names.push(name)
						})

					onStop(() => {
						set.headers.name = names.join(', ')
					})
				})
			})
			.onBeforeHandle(function luna() {})
			.get('/', () => 'a', {
				beforeHandle: [function kindred() {}]
			})

		const { headers } = await app.handle(req('/'))

		expect(headers.get('name')).toBe('luna, kindred')
	})

	it('report afterHandle units name', async () => {
		const app = new Elysia()
			.trace(({ onAfterHandle, set }) => {
				onAfterHandle(({ children, onStop }) => {
					const names = <string[]>[]

					for (const child of children)
						child(({ name }) => {
							names.push(name)
						})

					onStop(() => {
						set.headers.name = names.join(', ')
					})
				})
			})
			.onAfterHandle(function luna() {})
			.get('/', () => 'a', {
				afterHandle: [function kindred() {}]
			})

		const { headers } = await app.handle(req('/'))

		expect(headers.get('name')).toBe('luna, kindred')
	})

	it('report mapResponse units name', async () => {
		const app = new Elysia()
			.trace(({ onMapResponse, set }) => {
				onMapResponse(({ children, onStop }) => {
					const names = <string[]>[]

					for (const child of children)
						child(({ name }) => {
							names.push(name)
						})

					onStop(() => {
						set.headers.name = names.join(', ')
					})
				})
			})
			.mapResponse(function luna() {})
			.get('/', () => 'a', {
				mapResponse: [function kindred() {}]
			})

		const { headers } = await app.handle(req('/'))

		expect(headers.get('name')).toBe('luna, kindred')
	})

	it('report afterResponse units name', async () => {
		const app = new Elysia()
			.trace(({ onAfterResponse, set }) => {
				onAfterResponse(({ children, onStop }) => {
					const names = <string[]>[]

					for (const child of children)
						child(({ name }) => {
							names.push(name)
						})

					onStop(() => {
						expect(names.join(', ')).toBe('luna, kindred')
					})
				})
			})
			.onAfterResponse(function luna() {})
			.get('/', () => 'a', {
				afterResponse: [function kindred() {}]
			})

		app.handle(req('/'))
	})
})
