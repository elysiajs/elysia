import { Elysia, t, error, StatusMap } from '../src'
import { req } from '../test/utils'

const app = new Elysia()
	.get('/', () => {
		throw new Error("A")
	})
	.listen(3000)

// console.log(await res.text())
// console.log(res.status)
