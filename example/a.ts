import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia({ aot: false })
	.resolve(({ error }) => {
		return error(418, 'Chocominto yorimo anata!')
	})
	.get('/ruby-chan', () => 'Ruby chan! nani ga suki!?')

const res = await app.handle(req('/ruby-chan'))

console.log(res)

// expect(await res.text()).toBe('Chocominto yorimo anata!')
// expect(res.status).toBe(418)
