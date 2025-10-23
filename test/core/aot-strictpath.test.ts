import { describe, expect, it } from 'bun:test'
import { Elysia } from '../../src'

const req = (path: string) => new Request(`http://localhost${path}`)

describe('AOT and strictPath interaction', () => {
	it('should respect default strictPath:false when aot:false', async () => {
		const app = new Elysia({
			aot: false
		})
			.get('/ping', () => 'pong')
			.group('/api', (app) =>
				app.get('/ping', () => 'pong')
			)

		// All these should return 200 with default strictPath: false
		expect(await app.handle(req('/ping')).then((x) => x.status)).toBe(200)
		expect(await app.handle(req('/ping/')).then((x) => x.status)).toBe(200)
		expect(await app.handle(req('/api/ping')).then((x) => x.status)).toBe(200)
		expect(await app.handle(req('/api/ping/')).then((x) => x.status)).toBe(200)
	})

	it('should respect explicit strictPath:false when aot:false', async () => {
		const app = new Elysia({
			aot: false,
			strictPath: false
		})
			.get('/ping', () => 'pong')

		expect(await app.handle(req('/ping')).then((x) => x.status)).toBe(200)
		expect(await app.handle(req('/ping/')).then((x) => x.status)).toBe(200)
	})

	it('should respect strictPath:true when aot:false', async () => {
		const app = new Elysia({
			aot: false,
			strictPath: true
		})
			.get('/ping', () => 'pong')

		expect(await app.handle(req('/ping')).then((x) => x.status)).toBe(200)
		expect(await app.handle(req('/ping/')).then((x) => x.status)).toBe(404)
	})

	it('should handle group routes with default strictPath when aot:false', async () => {
		const app = new Elysia({
			aot: false
		}).group('/api', (app) =>
			app.get('/', () => 'Hello Elysia')
		)

		// Both /api and /api/ should work with default strictPath
		expect(await app.handle(req('/api')).then((x) => x.status)).toBe(200)
		expect(await app.handle(req('/api/')).then((x) => x.status)).toBe(200)
	})
})
