import { Elysia } from '../src'

const logs = []

const app = new Elysia()
	.trace(async ({ beforeHandle }) => {
		const { children } = await beforeHandle
		for (const child of children) {
			const { time: start, end, name } = await child

			console.log(name, 'took', (await end) - start, 'ms')
		}
	})
	.get('/', () => 'Hi', {
		beforeHandle: [function setup() {}]
	})
	.listen(3000)
