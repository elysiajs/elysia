import { Elysia } from '../src'
import { req } from '../test/utils'

const timeout = setTimeout(() => {
	throw new Error('Trace stuck')
}, 1000)

const a = new Elysia().trace({ as: 'global' }, async ({ set }) => {
	set.headers['X-Powered-By'] = 'elysia'
	clearTimeout(timeout)
})

const app = new Elysia().use(a).get('/', () => 'hi')

const response = await app.handle(req('/'))

// console.log(app.routes[0].composed?.toString())

const { headers } = await app.handle(req('/'))

console.log(headers.get('name'))
