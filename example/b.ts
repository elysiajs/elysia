import { Elysia } from '../src'
import { req } from '../test/utils'

const a = new Elysia().trace({ as: 'global' }, async ({ set }) => {
	set.headers['X-Powered-By'] = 'elysia'
})

const app = new Elysia().use(a).get('/', () => 'hi')

const response = await app.handle(req('/')).then(x => x.text()).then(console.log)
