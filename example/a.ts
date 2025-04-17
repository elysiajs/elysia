import { Elysia, t } from '../src'
import { post, req } from '../test/utils'

const secrets = 'hello world'

const app = new Elysia({
	cookie: {
		secrets,
		sign: true
	}
})
	.get(
		'/update',
		({ cookie: { name } }) => {
			if (!name.value) name.value = 'seminar: Himari'

			return name.value
		},
		{
			cookie: t.Cookie({
				name: t.Optional(t.String())
			})
		}
	)
	.listen(3000)

const response = await app.handle(
	req('/update', {
		// headers: {
		// 	cookie: `name=${await signCookie('seminar: Himari', secrets)}`
		// }
	})
)

// Qw1ZbfUtihR2tpR96RpJTF4B20xa8A8%2BJOr478qSfdU

// console.log(app.routes[0].compile().toString())
console.log(response.headers.toJSON())
