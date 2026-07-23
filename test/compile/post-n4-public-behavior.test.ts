import { describe, expect, it } from 'bun:test'

import { Elysia } from '../../src'
import { req } from '../utils'

describe('Post N+4 public runtime behavior', () => {
	it('preserves hyphenated derive keys', async () => {
		const app = new Elysia()
			.derive(() => ({ 'x-user': 'salty' }))
			.get('/', (context: any) => context['x-user'])

		await expect((await app.handle(req('/'))).text()).resolves.toBe(
			'salty'
		)
	})

	it('merges keys returned through a spread derive', async () => {
		const app = new Elysia()
			.derive(() => ({ ...{ user: 'salty', role: 'admin' } }))
			.get('/', (context: any) => `${context.user}:${context.role}`)

		await expect((await app.handle(req('/'))).text()).resolves.toBe(
			'salty:admin'
		)
	})

	it('makes each derive available to the derives that follow it', async () => {
		const app = new Elysia()
			.derive(() => ({ first: 1 }))
			.derive((context: any) => ({ second: context.first + 1 }))
			.get('/', (context: any) => `${context.first},${context.second}`)

		await expect((await app.handle(req('/'))).text()).resolves.toBe('1,2')
	})

	it('reads portable Headers implementations without toJSON', async () => {
		const app = new Elysia().get(
			'/headers',
			({ headers }: any) => headers['x-test']
		)
		const request = req('/headers', { headers: { 'x-test': 'ok' } })
		;(request.headers as any).toJSON = undefined

		await expect((await app.handle(request)).text()).resolves.toBe('ok')
	})

	it('does not mutate caller-owned hook options while sealing', async () => {
		const parse = () => undefined
		const derive = () => ({ user: 'salty' })
		const options: any = { parse, derive }
		const app = new Elysia().get('/sealed', options, ({ user }: any) => user)

		await expect((await app.handle(req('/sealed'))).text()).resolves.toBe(
			'salty'
		)
		expect(options).toEqual({ parse, derive })
		expect(options.beforeHandle).toBeUndefined()
	})

	it('resolves and applies a route-local afterHandle Promise', async () => {
		const app = new Elysia().get(
			'/after',
			{ afterHandle: () => Promise.resolve('wrapped') as any },
			() => 'original'
		)

		await expect((await app.handle(req('/after'))).text()).resolves.toBe(
			'wrapped'
		)
	})

	it('assimilates a transform Promise exactly once before the handler', async () => {
		let handled = false
		let transformInvoked = 0
		let transformSettled = false
		const app = new Elysia().get(
			'/transform',
			{
				transform: () => {
					transformInvoked++
					return Promise.resolve().then(() => {
						transformSettled = true
					}) as any
				}
			},
			() => {
				handled = true
				return transformSettled ? 'awaited' : 'discarded'
			}
		)

		await expect((await app.handle(req('/transform'))).text()).resolves.toBe(
			'awaited'
		)
		expect(handled).toBe(true)
		expect(transformInvoked).toBe(1)
	})

	it('preserves a pass-through response from a conservative afterHandle', async () => {
		const app = new Elysia().get(
			'/pass-through',
			{ afterHandle: ({ response }: any) => response },
			() => 'unchanged'
		)

		const response = await app.handle(req('/pass-through'))
		expect(response.status).toBe(200)
		await expect(response.text()).resolves.toBe('unchanged')
	})

	it('settles registered rejected and throwing-getter thenables once', async () => {
		for (const mode of ['reject', 'getter'] as const) {
			const failure = new Error(mode)
			let getter = 0
			let invoked = 0
			const handler = Object.defineProperty({}, 'then', {
				get() {
					getter++
					if (mode === 'getter') throw failure
					return (_resolve: Function, reject: Function) => {
						invoked++
						reject(failure)
					}
				}
			})
			const app = new Elysia()
				.error(({ error }) =>
					error === failure ? `handled:${mode}` : undefined
				)
				.get(`/${mode}`, handler as any)

			for (let request = 0; request < 2; request++)
				await expect(
					(await app.handle(req(`/${mode}`))).text()
				).resolves.toBe(`handled:${mode}`)

			expect({ getter, invoked }).toEqual({
				getter: 1,
				invoked: mode === 'reject' ? 1 : 0
			})
		}
	})

	it('materializes full headers for a route-local custom parser', async () => {
		const app = new Elysia().post(
			'/parse',
			{
				parse(context) {
					return (context.headers as any)['x-custom']
						? 'parsed'
						: undefined
				}
			},
			({ body }) => body
		)

		const response = await app.handle(
			req('/parse', {
				method: 'POST',
				headers: {
					'content-type': 'text/plain',
					'x-custom': 'yes'
				},
				body: 'ignored'
			})
		)
		await expect(response.text()).resolves.toBe('parsed')
	})
})
