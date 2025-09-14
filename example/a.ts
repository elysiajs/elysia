import { Elysia, t } from '../src'
import z from 'zod'
import { req } from '../test/utils'

const app = new Elysia().guard(
	{
		query: t.Object({
			name: t.Literal('lilith')
		})
	},
	(app) =>
		app.guard(
			{
				query: t.Object({
					limit: t.Number()
				})
			},
			(app) =>
				app.get(
					'/',
					({ query }) => {
						console.log(query)

						return query
					},
					{
						query: t.Object({
							playing: t.Boolean()
						})
					}
				)
		)
)

const value = await app
	.handle(req('/?name=lilith&playing=true&limit=10'))
	.then((x) => x.json())

console.log(value)
// expect(value).toEqual({
// 	name: 'lilith',
// 	playing: true,
// 	limit: 10
// })
