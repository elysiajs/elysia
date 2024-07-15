import { Elysia, t, UnwrapRoute } from '../src'
import { Prettify } from '../src/types'

new Elysia().group(
	'/:a',
	{
		beforeHandle({ params, params: { a } }) {
			return a
		}
	},
	(app) => app
)

// typeof app._routes['true']['post']['response']

// console.log(app.routes)

// const api = treaty(a)

// const { data, error, response } = await api.error.get()

// console.log(data, error, response)
