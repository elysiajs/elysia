import { Elysia } from '../src'

const app = new Elysia()
	.trace(async ({ handle, set, beforeHandle }) => {
		const { children } = await beforeHandle
		for (const child of children) {
			const { time: start, process, name } = await child
			const { time: end } = await process

			console.log(name, 'took', end - start, 'ms')
		}
	})
	.get('/', () => 'Hi', {
		beforeHandle: [function setup() {}, function work() {}]
	})
	.listen(3000)
