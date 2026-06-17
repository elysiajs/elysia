import { Elysia } from '../../src'
import { describe, expect, it } from 'bun:test'
import { post, req } from '../utils'

describe('Trace Detail', async () => {
	it('report parse units name', async () => {
		const app = new Elysia()
			.trace(({ onParse, set }) => {
				onParse(({ onEvent, onStop }) => {
					const names = <string[]>[]

					onEvent(({ name }) => {
						names.push(name)
					})

					onStop(() => {
						set.headers.name = names.join(', ')
					})
				})
			})
			.parse(function luna() {})
			.post(
				'/',
				{
					parse: [function kindred() {}]
				},
				({ body }) => body
			)

		const { headers } = await app.handle(post('/', {}))

		expect(headers.get('name')).toBe('luna, kindred')
	})

	it('report transform units name', async () => {
		const app = new Elysia()
			.trace(({ onTransform, set }) => {
				onTransform(({ onEvent, onStop }) => {
					const names = <string[]>[]

					onEvent(({ name }) => {
						names.push(name)
					})

					onStop(() => {
						set.headers.name = names.join(', ')
					})
				})
			})
			.transform(function luna() {})
			.get(
				'/',
				{
					transform: [function kindred() {}]
				},
				() => 'a'
			)

		const { headers } = await app.handle(req('/'))

		expect(headers.get('name')).toBe('luna, kindred')
	})

	it('report beforeHandle units name', async () => {
		const app = new Elysia()
			.trace(({ onBeforeHandle, set }) => {
				onBeforeHandle(({ onEvent, onStop }) => {
					const names = <string[]>[]

					onEvent(({ name }) => {
						names.push(name)
					})

					onStop(() => {
						set.headers.name = names.join(', ')
					})
				})
			})
			.beforeHandle(function luna() {})
			.get(
				'/',
				{
					beforeHandle: [function kindred() {}]
				},
				() => 'a'
			)

		const { headers } = await app.handle(req('/'))

		expect(headers.get('name')).toBe('luna, kindred')
	})

	it('report afterHandle units name', async () => {
		const app = new Elysia()
			.trace(({ onAfterHandle, set }) => {
				onAfterHandle(({ onEvent, onStop }) => {
					const names = <string[]>[]

					onEvent(({ name }) => {
						names.push(name)
					})

					onStop(() => {
						set.headers.name = names.join(', ')
					})
				})
			})
			.afterHandle(function luna() {})
			.get(
				'/',
				{
					afterHandle: [function kindred() {}]
				},
				() => 'a'
			)

		const { headers } = await app.handle(req('/'))

		expect(headers.get('name')).toBe('luna, kindred')
	})

	it('report mapResponse units name', async () => {
		const app = new Elysia()
			.trace(({ onMapResponse, set }) => {
				onMapResponse(({ onEvent, onStop }) => {
					const names = <string[]>[]

					onEvent(({ name }) => {
						names.push(name)
					})

					onStop(() => {
						set.headers.name = names.join(', ')
					})
				})
			})
			.mapResponse(function luna() {})
			.get(
				'/',
				{
					mapResponse: [function kindred() {}]
				},
				() => 'a'
			)

		const { headers } = await app.handle(req('/'))

		expect(headers.get('name')).toBe('luna, kindred')
	})

	it('report afterResponse units name', async () => {
		const app = new Elysia()
			.trace(({ onAfterResponse, set }) => {
				onAfterResponse(({ onEvent, onStop }) => {
					const names = <string[]>[]

					onEvent(({ name }) => {
						names.push(name)
					})

					onStop(() => {
						expect(names.join(', ')).toBe('luna, kindred')
					})
				})
			})
			.afterResponse(function luna() {})
			.get(
				'/',
				{
					afterResponse: [function kindred() {}]
				},
				() => 'a'
			)

		app.handle(req('/'))
	})
})
