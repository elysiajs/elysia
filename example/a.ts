import { Elysia } from '../src'
import { req } from '../test/utils'

const plugin = new Elysia()
	.macro({
		account: (a: boolean) => ({
			resolve: ({ error }) => ({
				account: 'A'
			})
		})
	})
	.guard({
		account: true
	})
	.get('/local', ({ account }) => {
		console.log(account)
	})

const parent = new Elysia().use(plugin).get('/plugin', (context) => {
	console.log(context.account)
})

const app = new Elysia().use(parent).get('/global', (context) => {
	console.log(context.account)
})

await Promise.all(
	['/local', '/plugin', '/global'].map((path) => app.handle(req(path)))
)
