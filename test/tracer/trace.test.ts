import { describe, expect, it } from 'bun:test'
import { Elysia, type TraceProcess, type TraceEvent } from '../../src'
import { req } from '../utils'

describe('trace', () => {
	it('inherits plugin', async () => {
		const timeout = setTimeout(() => {
			throw new Error('Trace stuck')
		}, 1000)

		const a = new Elysia().trace({ as: 'global' }, async ({ set }) => {
			set.headers['X-Powered-By'] = 'elysia'
			clearTimeout(timeout)
		})

		const app = new Elysia().use(a).get('/', () => 'hi')

		const response = await app.handle(req('/'))

		expect(response.headers.get('X-Powered-By')).toBe('elysia')
		expect(response.status).toBe(200)
	})

	it('handle scoped instance', async () => {
		const timeout = setTimeout(() => {
			throw new Error('Trace stuck')
		}, 1000)

		const a = new Elysia().trace({ as: 'global' }, async ({ set }) => {
			set.headers['X-Powered-By'] = 'elysia'
			clearTimeout(timeout)
		})

		const b = new Elysia({ scoped: true }).get('/scoped', () => 'hi')

		const app = new Elysia()
			.use(a)
			.use(b)
			.get('/', () => 'hi')

		const response = await app.handle(req('/scoped'))

		expect(response.headers.get('X-Powered-By')).toBe('elysia')
		expect(response.status).toBe(200)
	})

	it('call all trace', () => {
		const called = <string[]>[]

		const detectEvent =
			(event: TraceEvent) =>
			({ onStop }: TraceProcess<'begin'>) => {
				onStop(() => {
					called.push(event)
				})
			}

		const plugin = new Elysia().trace(
			{ as: 'scoped' },
			({
				onRequest,
				onParse,
				onTransform,
				onBeforeHandle,
				onHandle,
				onAfterHandle,
				onMapResponse,
				onAfterResponse
			}) => {
				onRequest(detectEvent('request'))
				onParse(detectEvent('parse'))
				onTransform(detectEvent('transform'))
				onBeforeHandle(detectEvent('beforeHandle'))
				onHandle(detectEvent('handle'))
				onAfterHandle(detectEvent('afterHandle'))
				onMapResponse(detectEvent('mapResponse'))
				onAfterResponse(detectEvent('afterResponse'))

				onAfterResponse(() => {
					expect(called).toEqual([
						'request',
						'parse',
						'transform',
						'beforeHandle',
						'handle',
						'afterHandle',
						'mapResponse',
						'afterResponse'
					])
				})
			}
		)

		const app = new Elysia().get('/', 'hi')
	})
})
