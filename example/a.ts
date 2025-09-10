import { Elysia, t } from '../src'
import { post, req } from '../test/utils'

new Elysia().post(
	'/user',
	({ q }) => {
		return { q: 'a' }
	},
	{
		response: {
			200: t.Object({
				name: t.String()
			}),
			401: t.Object({
				q: t.String()
			})
		}
	}
)
