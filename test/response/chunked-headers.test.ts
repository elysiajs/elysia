import { describe, expect, it } from 'bun:test'
import { Elysia } from '../../src'
import type { Context } from '../../src/context'
import { WebStandardAdapter } from '../../src/adapter/web-standard'
import { req } from '../utils'

// I have nothing but my burger and I want nothing more
describe('Chunked Response headers', () => {
	for (const adapter of [undefined, WebStandardAdapter])
		for (const aot of [true, false])
			for (const early of [true, false])
				for (const count of [0, 1, 2])
					it(`preserves response headers and ${count} route cookies (${adapter?.name ?? 'bun'}, aot=${aot}, early=${early})`, async () => {
						const handler = ({ set, cookie }: Context) => {
							set.headers['x-route'] = 'route'
							for (let i = 0; i < count; i++)
								cookie[`route${i}`].value = 'value'
							return new Response(
								new ReadableStream({
									start(controller) {
										controller.enqueue(
											new TextEncoder().encode('hello')
										)
										controller.close()
									}
								}),
								{
									status: 202,
									headers: [
										['transfer-encoding', 'chunked'],
										['x-response', 'original'],
										['set-cookie', 'a=1; Path=/'],
										['set-cookie', 'b=2; Path=/']
									]
								}
							)
						}
						const app = new Elysia({ adapter, aot })
						if (early) app.onBeforeHandle(handler)
						app.get('/', early ? () => 'unreachable' : handler)
						const response = await app.handle(req('/'))
						expect(response.status).toBe(202)
						expect(response.headers.get('x-response')).toBe(
							'original'
						)
						expect(response.headers.get('x-route')).toBe('route')
						expect(response.headers.getSetCookie()).toEqual([
							'a=1; Path=/',
							'b=2; Path=/',
							...Array.from(
								{ length: count },
								(_, i) => `route${i}=value; Path=/`
							)
						])
						expect(await response.text()).toBe('hello')
					})
})
