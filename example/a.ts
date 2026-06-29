import { Elysia, t, prefix } from '../src'
import { t as t2 } from '../dist'
import { Validator } from '../src/validator'

const app = new Elysia()
	.mapResponse(({ set, responseValue }) => {
		set.headers['x-powered-by'] = 'Elysia'
	})
	.get('/', new Response('ok'))

const response = await app.handle('/')
const value = await response.text()

console.log(response)
