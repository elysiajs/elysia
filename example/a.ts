import { Elysia, t, error } from '../src'
import { req } from '../test/utils'

const app = new Elysia()
	.get('/', () => {
		throw error("I'm a teapot")
	})
	.listen(3000)

// console.log(await res.text())
// console.log(res.status)
