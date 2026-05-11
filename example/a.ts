import { Elysia, t } from '../src'

new Elysia()
	.derive(() => {
		console.log('thing')
	})
	.ws('/', function* () {
		yield 'hello'
	})
	.listen(3000)
