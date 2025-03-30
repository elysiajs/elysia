import { Elysia, t, form, file, error } from '../src'
import { post, req } from '../test/utils'

const app1 = new Elysia()
	.state('A', 'A')
	.error('A', Error)
	.parser('b', () => {})

const app2 = new Elysia()
	.state('B', 'B')
	.error('B', Error)
	.parser('b', () => {})

const app = new Elysia().use(app1).use(app2)
