import { Elysia, t } from '../src'
import { req } from '../test/utils'

const p1 = new Elysia().model({
	a: t.String()
})

const p2 = new Elysia().model({
	b: t.Number()
})

const app = new Elysia()
	.use([p1, p2])
	.model({
		c: t.String()
	})

console.log(app.models)
