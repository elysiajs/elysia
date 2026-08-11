import { Elysia, problem, HTTPError, t } from '../src'

new Elysia({
	cookie: {
		secrets: 'Fischl von Luftschloss Narfidort'
	}
})

type A = (typeof app)['~Routes']['get']['response']
