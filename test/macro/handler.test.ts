import { describe, it, expect, afterEach } from 'bun:test'
import { Elysia } from '../../src'
import { Validator } from '../../src/validator'
import { Compiled } from '../../src/compile/aot'
import { compileFromFrozenHandler } from '../aot/_manifest'

describe('Macro handler', () => {
	it('wraps the handler and sees the same context', async () => {
		const order: string[] = []
		const seen: unknown[] = []

		const app = new Elysia()
			.macro({
				tap: {
					handler: (handler) => (context) => {
						order.push('wrap in')
						seen.push(context)
						const value = handler(context)
						order.push('wrap out')
						return value
					}
				}
			})
			.get('/', { tap: true }, (context) => {
				order.push('handler')
				seen.push(context)
				return 'ok'
			})

		await expect(app.handle('/').then((x) => x.text())).resolves.toBe('ok')
		expect(order).toEqual(['wrap in', 'handler', 'wrap out'])
		expect(seen[0]).toBe(seen[1])
	})

	it('replaces the handler value before afterHandle', async () => {
		let afterHandleSaw: unknown

		const app = new Elysia()
			.macro({
				replace: {
					handler: (handler) => (context) => {
						handler(context)
						return 'replaced'
					}
				}
			})
			.get(
				'/',
				{
					replace: true,
					afterHandle: ({ responseValue }) => {
						afterHandleSaw = responseValue
					}
				},
				() => 'original'
			)

		await expect(app.handle('/').then((x) => x.text())).resolves.toBe(
			'replaced'
		)
		expect(afterHandleSaw).toBe('replaced')
	})

	it('composes with the macro listed later in the route options outermost', async () => {
		const order: string[] = []
		const wrap = (name: string) => ({
			handler: (handler: Function) => (context: unknown) => {
				order.push(`${name} in`)
				const value = handler(context)
				order.push(`${name} out`)
				return value
			}
		})

		const app = new Elysia()
			.macro({ a: wrap('a'), b: wrap('b') })
			.get('/', { a: true, b: true }, () => {
				order.push('handler')
				return 'ok'
			})

		await app.handle('/')

		expect(order).toEqual(['b in', 'a in', 'handler', 'a out', 'b out'])
	})

	it('runs lifecycle hooks around the wrapper, a macro without handler is unchanged', async () => {
		const order: string[] = []

		const app = new Elysia()
			.macro({
				plain: {
					beforeHandle: () => {
						order.push('beforeHandle')
					}
				},
				tap: {
					handler: (handler) => (context) => {
						order.push('wrap')
						return handler(context)
					}
				}
			})
			.get(
				'/',
				{
					plain: true,
					tap: true,
					afterHandle: () => {
						order.push('afterHandle')
					}
				},
				() => {
					order.push('handler')
					return 'ok'
				}
			)
			.get('/plain', { plain: true }, () => 'plain')

		await app.handle('/')
		expect(order).toEqual([
			'beforeHandle',
			'wrap',
			'handler',
			'afterHandle'
		])

		await expect(app.handle('/plain').then((x) => x.text())).resolves.toBe(
			'plain'
		)
	})

	it('keeps body parsing and async handlers through the wrapper', async () => {
		const app = new Elysia()
			.macro({
				tap: {
					handler: (handler) => (context) => handler(context)
				}
			})
			.post('/echo', { tap: true }, ({ body }) => body)
			.get('/async', { tap: true }, async () => 'async')

		const echo = await app.handle(
			new Request('http://localhost/echo', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ n: 1 })
			})
		)
		await expect(echo.json()).resolves.toEqual({ n: 1 })
		await expect(app.handle('/async').then((x) => x.text())).resolves.toBe(
			'async'
		)
	})

	it('wraps a route declared inside a nested plugin', async () => {
		const order: string[] = []

		const macro = new Elysia({ name: 'tap' }).macro({
			tap: {
				handler: (handler) => (context) => {
					order.push('wrap')
					return handler(context)
				}
			}
		})

		const nested = new Elysia({ prefix: '/nested' })
			.use(macro)
			.get('/', { tap: true }, () => {
				order.push('handler')
				return 'nested'
			})

		const app = new Elysia().use(nested)

		await expect(app.handle('/nested').then((x) => x.text())).resolves.toBe(
			'nested'
		)
		expect(order).toEqual(['wrap', 'handler'])
	})

	describe('AOT', () => {
		afterEach(() => {
			Compiled.clear()
			Validator.clear()
		})

		const build = (order: string[]) =>
			new Elysia()
				.macro({
					tap: {
						handler: (handler) => (context) => {
							order.push('wrap')
							handler(context)
							return 'wrapped'
						}
					}
				})
				.get(
					'/',
					{
						tap: true,
						afterHandle: ({ responseValue }) => {
							order.push(`afterHandle ${responseValue}`)
						}
					},
					() => {
						order.push('handler')
						return 'original'
					}
				)

		it('runs the wrapper from the reconstructed factory', async () => {
			const order: string[] = []
			const frozen = await compileFromFrozenHandler(() => build(order))

			await expect(
				frozen.handle('/').then((x) => x.text())
			).resolves.toBe('wrapped')
			expect(order).toEqual(['wrap', 'handler', 'afterHandle wrapped'])
		})
	})
})
