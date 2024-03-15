import { Elysia, t } from '../src'
import { cors } from '../../cors/src'

const app = new Elysia({ precompile: true })
	.guard(
		{
			query: t.Object({
				__omit: t.ObjectString({
					'x-id': t.Numeric(),
					'x-token': t.String({ minLength: 150 })
				})
			})
		},
		(app) =>
			app.ws('/v2/socket/user', {
				open(ws) {
					ws.send('test')
				}
			})
	)
	.listen(3000)
