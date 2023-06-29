import { Elysia, t } from '../src'

class Teapot extends Error {}

const knownError = (app: Elysia) =>
	app
		.onError<{
			IM_TEAPOT: Teapot
		}>()
		.onError<{
			UH_NO: Error
			TAROMARU: Error
		}>(({ code, error }) => {
			if (code === 'IM_TEAPOT')
				return new Response("I'm a teapot", {
					status: 418
				})
		})

const app = new Elysia()
	.use(knownError)
	.onError(({ code, error, set }) => {
		switch (code) {
			case 'IM_TEAPOT':
				set.status = 400

				return error.message
		}
	})
	.listen(3000)
