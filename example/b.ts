import Elysia from '../src'

const app = new Elysia()
	.get('/', ({ set }) => {
		set.status = "I'm a teapot"

		return Bun.file('example/teapot.webp')
	})
	.trace(async ({ beforeHandle }) => {
		try {
			console.log('Start BeforeHandle')
			const { end } = await beforeHandle

			const a = await end
		} catch {
			console.log("A")
		}
	})
	.get('/trace', () => 'a', {
		beforeHandle: [
			function setup() {},
			function error() {
				throw new Error('A')
			},
			function resume() {}
		],
		afterHandle() {
			console.log('After')
		}
	})
	.listen(3000)
