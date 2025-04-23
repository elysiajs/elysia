import { Elysia, t } from '../src'
import { post } from '../test/utils'

const plugin = new Elysia({
	sanitize: (value) => {
		if (value === 'b') return 'ok'
		return value
	}
}).post('/', ({ body }) => body, {
	body: t.Object({
		a: t.String(),
		b: t.String(),
		c: t.String()
	})
})

const app = new Elysia({
	sanitize: (value) => {
		if (value === 'a') return 'ok'
		return value
	}
}).use(plugin)

const response = await app
	.handle(
		post('/', {
			a: 'a',
			b: 'b',
			c: 'c'
		})
	)
	.then((x) => x.json())

console.log(response)
