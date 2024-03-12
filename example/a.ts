import { Elysia, t } from '../src'
import { cors } from '../../cors/src'

const app = new Elysia({ precompile: true })
	.post('/', ({ body, cookie: { session } }) => {
		session!.value = 'hi'

		return body
	})
	.listen(3000)
