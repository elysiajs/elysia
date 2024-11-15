import { Elysia, Static, t } from '../src'
import { UnwrapTypeModule } from '../src/types'
import { req } from '../test/utils'

const app = new Elysia()
	.model({
		A: t.Object({
			b: t.Ref('B')
		}),
		B: t.Object({
			c: t.Ref('A')
		})
	})
	.macro({
		user: (enabled: boolean) => ({
			resolve: ({ query: { name = 'anon' } }) => ({
				user: {
					name
				}
			})
		}),
		admin: (enabled: boolean) => ({
			resolve: ({ query: { name = 'anon' } }) => ({
				admin: {
					name
				}
			})
		})
	})
	.resolve(() => {
		const admin =
			Math.random() > 0.5
				? {
						name: 'admin'
					}
				: undefined

		return {
			admin
		}
	})
	.get('/', ({ user, admin, body }) => {}, {
		user: true,
		admin: true,
		query: t.Object({
			name: t.String()
		}),
		body: 'A'
	})

app.handle(req('/'))
	.then((x) => x.json())
	.then(console.log)

const modules = app.models.modules

const A = modules.Import('A')
type A = Static<typeof A>
