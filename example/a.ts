import { Elysia, t, ValidationError } from '../src'
import { req } from '../test/utils'

const app = new Elysia({
	normalize: true
})
	.get('/', ({ error }) => ({
		hello: 'world',
		a: 'b'
	}), {
		response: {
			200: t.Object({
				hello: t.String()
			}),
			418: t.Object({
				name: t.Literal('Nagisa')
			})
		}
	})

const response = await app.handle(req('/')).then((x) => x.json())

console.dir(response, { depth: null })