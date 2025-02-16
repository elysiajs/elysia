import { Elysia } from '../src'

const app = new Elysia({ precompile: true })
	.get('/', function* () {
		yield "a"
		yield "b"
		yield "c"
	}, {
		mapResponse({ response }) {
			console.log({ response })
		}
	})
	.listen(3000)
