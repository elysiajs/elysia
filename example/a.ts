import { Elysia, t } from '../src'
import { parseCookie } from '../src/cookie'
import { req } from '../test/utils'

const app = new Elysia()
	.get(
		'/council',
		({ cookie: { council } }) =>
			(council.value = [
				{
					name: 'Rin',
					affilation: 'Administration'
				}
			])
	)
	.listen(3000)

const cookieString = 'fischl=Princess; eula=Noble; amber=Knight'
const result = await parseCookie({
	'cookie': {}
} as any, cookieString)

console.log(result)
