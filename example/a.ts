import { t } from '../src/type'
import { RouteValidator } from '../src/schema/route'

console.log(t.Optional(t.String()))

const route = new RouteValidator({
	body: t.Object({
		name: t.String(),
		age: t.Optional(t.Number())
	}),
	response: {
		200: t.Object({
			name: t.String(),
			age: t.Number()
		})
	}
})

const body = route.body

console.dir(body.tb.Schema(), {
	depth: null
})

console.log(
	body.Check({
		name: 'Jane Doe'
		// age: 200
	})
)
