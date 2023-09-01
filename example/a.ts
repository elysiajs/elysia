import { Elysia } from '../src'

const app = new Elysia()
	.onTrace(({ onEvent, listener }) => {
		listener.on(
			'all',
			async ({ id, event, name, type, process, isGroup }) => {
				const a = performance.now()

				await process

				console.log(
					id,
					event,
					name,
					'took',
					performance.now() - a,
					'ms'
				)
			}
		)
	})
	.get('/', () => 'hi', {
		beforeHandle: [function a() {}, function b() {}]
	})
	.listen(8080)
