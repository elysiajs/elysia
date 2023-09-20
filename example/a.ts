import { Elysia, t } from '../src'
import { post } from '../test/utils'

const app = new Elysia({
	aot: false
})
	.get(
		'/update',
		({ cookie: { name } }) => {
			name.value = 'Himari'

			return name.value
		},
		{
			cookie: t.Cookie(
				{
					name: t.Optional(t.String())
				},
				{
					secrets: 'Fischl',
					sign: ['name']
				}
			),
			error() {
				console.log("A")
			}
		}
	)
	.listen(3000)
