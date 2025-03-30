import { Elysia, t, form, file, error } from '../src'
import { post, req } from '../test/utils'

const local = new Elysia()
	.guard({
		schema: 'standalone',
		cookie: t.Object({
			a: t.String()
		})
	})
	.get('/', ({ cookie }) => {}, {
		cookie: t.Object({
			a: t.Optional(t.String())
		})
	})

const a = await local.handle(req('/'))

console.log(a.status)
