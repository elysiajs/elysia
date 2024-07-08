import { Elysia, t } from '../src'
import { req } from '../test/utils'

const a = new Elysia({ name: 'a' }).trace({ as: 'global' }, () => {})

const app = new Elysia()
	.use(a)
	.use(a)
	.get('/', () => {})

console.log(app.routes[0].hooks)
