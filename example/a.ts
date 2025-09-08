import { Elysia, MaybeArray, status, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia().get(
	'/council',
	({ cookie: { council } }) => council.value,
	{
		cookie: t.Cookie({
			council: t.Object({
				name: t.String(),
				affilation: t.String()
			})
		})
	}
)

const expected = {
	name: 'Rin',
	affilation: 'Administration'
}

const response = await app.handle(
	req('/council', {
		headers: {
			cookie: 'council=' + JSON.stringify(expected)
		}
	})
)

console.log(await response.json())
console.log(app.routes[0].compile().toString())
