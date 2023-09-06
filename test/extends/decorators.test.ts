/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, it, expect } from 'bun:test'
import { Elysia } from '../../src'
import { req } from '../utils'

describe('Decorate', () => {
	it('decorate primitive', async () => {
		const app = new Elysia()
			.decorate('name', 'Ina')
			.get('/', ({ name }) => name)

		const res = await app.handle(req('/')).then((r) => r.text())
		expect(res).toBe('Ina')
	})

	it('decorate multiple', async () => {
		const app = new Elysia()
			.decorate('name', 'Ina')
			.decorate('job', 'artist')
			.get('/', ({ name, job }) => ({
				name,
				job
			}))

		const res = await app.handle(req('/')).then((r) => r.json())
		expect(res).toEqual({
			name: 'Ina',
			job: 'artist'
		})
	})

	it('decorate object', async () => {
		const app = new Elysia()
			.decorate({
				name: 'Ina',
				job: 'artist'
			})
			.get('/', ({ name, job }) => ({
				name,
				job
			}))

		const res = await app.handle(req('/')).then((r) => r.json())
		expect(res).toEqual({
			name: 'Ina',
			job: 'artist'
		})
	})

	it('remap object', async () => {
		const app = new Elysia()
			.decorate({
				name: 'Ina',
				job: 'artist'
			})
			.decorate(({ job, ...rest }) => ({
				...rest,
				job: 'streamer'
			}))
			.get('/', ({ name, job }) => ({
				name,
				job
			}))

		const res = await app.handle(req('/')).then((r) => r.json())
		expect(res).toEqual({
			name: 'Ina',
			job: 'streamer'
		})
	})

	it('inherits functional plugin', async () => {
		const plugin = () => (app: Elysia) => app.decorate('hi', () => 'hi')

		const app = new Elysia().use(plugin()).get('/', ({ hi }) => hi())

		const res = await app.handle(req('/')).then((r) => r.text())
		expect(res).toBe('hi')
	})

	it('inherits instance plugin', async () => {
		const plugin = new Elysia().decorate('hi', () => 'hi')

		const app = new Elysia().use(plugin).get('/', ({ hi }) => hi())

		const res = await app.handle(req('/')).then((r) => r.text())
		expect(res).toBe('hi')
	})

	it('accepts any type', async () => {
		const app = new Elysia()
			.decorate('hi', {
				there: {
					hello: 'world'
				}
			})
			.get('/', ({ hi }) => hi.there.hello)

		const res = await app.handle(req('/')).then((r) => r.text())
		expect(res).toBe('world')
	})
})
