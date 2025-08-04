import { Elysia, t } from '../src'

const app = new Elysia({
	aot: false,
	cookie: {
		// both constructor secret and cookie schema (see below) doesn't work
		secrets: 'Fischl von Luftschloss Narfidort',
		sign: ['profile']
	}
})
	.get(
		'/',
		({ cookie: { profile } }) => {
			profile.value = {
				id: 617,
				name: 'Summoning 101'
			}

			return profile.value
		},
		{
			cookie: t.Cookie(
				{
					profile: t.Optional(
						t.Object({
							id: t.Numeric(),
							name: t.String()
						})
					)
				},
				{
				  secrets: "Fischl von Luftschloss Narfidort",
				  sign: ["profile"],
				}
			)
		}
	)
	.listen(3000)

// console.log(app.routes[0]?.compile().toString())
