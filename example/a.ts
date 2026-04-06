import { t } from '../src/type'
import { RouteValidator } from '../src/schema/route'

const route = new RouteValidator({
	body: t.Object({
		name: t.String(),
		age: t.Number()
	}),
	response: {
		200: t.Object({
			name: t.String(),
			age: t.Number()
		})
	}
})

const body = route.body

console.log(
	body.Check(
		body.Decode({
			name: 'Jane Doe',
			// @ts-expect-error
			age: '30'
		})
	)
)
