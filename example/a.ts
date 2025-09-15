import { Prettify } from 'elysia/types'
import { Elysia, ElysiaCustomStatusResponse, t } from '../src'
import { req } from '../test/utils'
import { Tuple } from '../src/types'

type PickOne<T> = T extends any ? T : never

new Elysia().get(
	'/test',
	({ status }) => {
		return status(200, { key2: 's', id: 2 })
	},
	{
		response: {
			200: t.Union([
				t.Object({
					key2: t.String(),
					id: t.Literal(2)
				}),
				t.Object({
					key: t.Number(),
					id: t.Literal(1)
				})
			])
		}
	}
)
