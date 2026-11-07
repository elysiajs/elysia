import { Elysia, t } from '../../../src'

// cookie, a generator, a body schema and a route error hook each link their
// own resolvers into the replayed handlers
export const app = new Elysia()
	.get('/cookie', ({ cookie: { name } }) => {
		name.value = 'set'
		return 'ok'
	})
	.get('/stream', function* () {
		yield 'a'
		yield 'b'
	})
	.post(
		'/body',
		{ body: t.Object({ name: t.String() }) },
		({ body }) => body.name
	)
	.get('/error', { error: () => 'handled' }, () => {
		throw new Error('boom')
	})
