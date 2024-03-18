import { Elysia, error, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia({ precompile: true })
	.get('/', 'hi')
	.listen(3000)

console.log(app.fetch.toString())
