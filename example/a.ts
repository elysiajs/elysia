import { Elysia, t } from '../src'

new Request('', {
	duplex: 'half',
})

const app = new Elysia().get(
	'/',
	() => {
		return {
			duration: 200
		}
	},
	{
		response: {
			200: t.Object({
				duration: t.Number()
			}),
			400: t.Object({
				stuff: t.Number()
			})
		},
		afterResponse({ response }) {
			// expectTypeOf<typeof response>().toEqualTypeOf<
			// 	| {
			// 			duration: number
			// 	  }
			// 	| {
			// 			stuff: number
			// 	  }
			// >()
			// return undefined as any
		}
	}
)
