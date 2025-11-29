import { Elysia, t } from '../src'

const app = new Elysia().get(
	'/',
	() => ({ message: 'Hello Elysia' as const }),
	{
		response: {
			200: t.Object({
				message: t.Literal('Hello Elysia')
			})
		}
	}
)

type AppResponse = (typeof app)['~Routes']['get']['response']

// Should properly infer the 200 response type, not [x: string]: any
const _typeTest: AppResponse extends {
	200: { message: 'Hello Elysia' }
}
	? true
	: false = true

// Test with multiple status codes including 200
const app2 = new Elysia().post(
	'/test',
	({ status }) => {
		if (Math.random() > 0.5) {
			return status(200, { message: 'Hello Elysia' as const })
		}

		return status(422, { error: 'Validation error' })
	},
	{
		response: {
			200: t.Object({
				message: t.Literal('Hello Elysia')
			}),
			422: t.Object({
				error: t.String()
			})
		}
	}
)

type App2Response = (typeof app2)['~Routes']['test']['post']['response']

type A = App2Response extends {
	200: { message: 'Hello Elysia' }
	422: { error: string }
} ? true : false
