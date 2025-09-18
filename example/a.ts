import { Elysia, t } from '../src'
import { openapi } from '@elysiajs/openapi'

const macroMiddleware1 = new Elysia({ name: 'my-middleware-1' })
	.guard({
		as: 'scoped',
		headers: t.Object({
			role: t.UnionEnum(['admin', 'user'])
		}),
		body: t.Object({
			foo: t.String()
		})
	})
	.macro({
		auth: {
			resolve: ({
				headers, // Record<string, string | undefined> <------- ERROR IS HERE - should be typed
				body // unknown <------- ERROR IS HERE - should be typed
			}) => {
				console.log('headers and body are still validated at runtime!')
				console.log(headers, body) // will not allow e.g. headers: { foo: 123 }
			}
		}
	})

const macroMiddleware2 = new Elysia({ name: 'my-middleware-2' })
	.guard({
		as: 'scoped',
		headers: t.Object({
			role: t.UnionEnum(['admin', 'user'])
		}),
		body: t.Object({
			foo: t.String()
		})
	})
	.macro('auth', {
		resolve: ({
			headers, // { role: "admin" | "user" } <------- no error
			body // { foo: string } <------- no error
		}) => {
			console.log('headers and body are still validated at runtime!')
			console.log(headers, body) // will not allow e.g. headers: { foo: 123 }
		}
	})

const app1 = new Elysia()
	.use(macroMiddleware1)
	.post('/', () => 'Hello World 1', {
		auth: true
	})

const app2 = new Elysia()
	.use(macroMiddleware2)
	.post('/', () => 'Hello World 2', {
		auth: true
	})
