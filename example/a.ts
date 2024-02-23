import { Elysia, error, t } from '../src'
import { post, req } from '../test/utils'

const app = new Elysia()
	.decorate({ a: 'a' })
	.state({ a: 'a' })
	.model('a', t.String())
	.error('a', Error)
