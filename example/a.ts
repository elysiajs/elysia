import { Elysia, t } from '../src'

const app = new Elysia()
	.macro({
		role: (role: 'admin' | 'user') => ({
			body: t.Object({
				ok: t.String()
			}),
			derive: () => ({ ok: 'a' } as const)
		})
	})
	.get('/', ({ ok }) => ok, {
		role: 'admin'
	})

type Response = (typeof app)['~Routes']['get']['response']

app.handle('/')
	.then((x) => x.text())
	.then(console.log)
