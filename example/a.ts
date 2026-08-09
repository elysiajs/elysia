import { Elysia, problem, HTTPError, t } from '../src'

new Elysia({
	cookie: {
		secrets: 'Fischl von Luftschloss Narfidort'
	}
}).get(
	'/',
	{
		cookie: t.Object({
			name: t.Cookie(t.String(), {
				sign: true
			})
		})
	},
	// verify and unsign automatically
	({ cookie: { name } }) => {
		// sign automatically
		name.value = 'saltyaom'
	}
)

type A = (typeof app)['~Routes']['get']['response']
