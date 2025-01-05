import { Elysia, t, error, StatusMap } from '../src'
import { req } from '../test/utils'

const app = new Elysia()
	.macro({
		user: {
			resolve({ query: { name = 'anon' } }) {
				return {
					user: {
						name
					}
				}
			}
		}
	})
	.get('/', ({ user }) => user, {
		user: true
	})

const [a, b] = await Promise.all([
	app.handle(req('/')).then((x) => x.text()),
	app.handle(req('/?name=hoshino')).then((x) => x.text())
])

console.log(a, b)
