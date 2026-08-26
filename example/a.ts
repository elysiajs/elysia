import { Elysia, t } from '../src'

new Elysia()
	.macro({
		a: () => ({
			beforeHandle({ request, set }) {

			}
		})
	})
