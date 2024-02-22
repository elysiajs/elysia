import { Elysia, error } from '../src'
import { post, req } from '../test/utils'

export const authGuard = new Elysia().macro(({ onBeforeHandle }) => ({
	requiredUser(value: boolean) {
		onBeforeHandle(async () => {
			if (value) {
				return error(401, {
					code: 'S000002',
					message: 'Unauthorized'
				})
			}
		})
	}
}))

export const testRoute = new Elysia({
	prefix: '/test',
	name: 'testRoute'
})
	.use(authGuard)
	.guard({
		requiredUser: true
	})
	.get('', () => 'Hello Elysia test')

const app = new Elysia().use(testRoute).get('/', () => 'Hello Elysia')

app.handle(req('/'))
	.then((t) => t.text())
	.then(console.log)

app.handle(req('/test'))
	.then((t) => t.text())
	.then(console.log)
