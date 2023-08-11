import { Elysia } from '../src'

const app = new Elysia({
	aot: false
})
	.derive(() => {
		return {
			a: 'B'
		}
	})
	.get('/', ({ a }) => `a: ${a}`)
	.post('/', () => 'world')
	.listen(3000)

// console.log(app.routes)
