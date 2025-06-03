import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia().get(
	'/api/:required/:optional?',
	({ params }) => params.required
)

const response = await app
	.handle(new Request('http://localhost/api/yay/ok'))
	.then((x) => x.text())

console.log(response)

// expect(await res.text()).toBe('Chocominto yorimo anata!')
// expect(res.status).toBe(418)
