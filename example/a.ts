import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia()
	.get(
		'/',
		() => ({
			id: 1,
			name: 'SaltyAom',
			bio: 'I like train',
			metadata: {
				alias: 'SaltyAom',
				country: 'Thailand'
			}
		}),
		{
			response: t.Object({
				id: t.Number(),
				name: t.String(),
				bio: t.String(),
				metadata: t.Object({
					alias: t.String(),
					country: t.String()
				})
			})
		}
	)
	.listen(3000)

const response = await app.handle(req('/')).then((x) => x.json())
console.log(response)

console.log(app.routes[0].compile().toString())
