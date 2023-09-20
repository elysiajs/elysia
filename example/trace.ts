import { Elysia } from '../src'

const sleep = (time = 1000) =>
	new Promise((resolve) => setTimeout(resolve, time))

const app = new Elysia()
	.trace(async ({ beforeHandle, request, response }) => {
		const { children, time: start, end } = await beforeHandle
		for (const child of children) {
			const { time: start, end, name } = await child

			console.log(name, 'took', (await end) - start, 'ms')
		}

		console.log('beforeHandle took', (await end) - start)
	})
	.get('/', () => 'Hi', {
		beforeHandle: [
			function setup() {},
			async function delay() {
				await sleep()
			}
		]
	})
	.listen(3000)
