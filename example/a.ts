import { Elysia, t } from '../src'
import { parseCookie } from '../src/cookie'
import { req } from '../test/utils'

const app = new Elysia({ name: 'macro' })
	.macro(() => {
		return {
			user: (type?: 'signed-in' | 'signed-out') => {
				return ':)'
			}
		}
	})
	.get('/', () => {
		return 'I fail at runtime but not static checks'
	})
	.listen(3000)

// console.log(app.routes[0].composed?.toString())
