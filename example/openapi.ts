import { Elysia, t } from '../src'
import { openapi as OpenAPI } from '@elysiajs/openapi'
import { fromTypes } from '@elysiajs/openapi/gen'

const openapi = (a: any) =>
	new Elysia().use((app) => {
		app.use(
			// @ts-ignore
			OpenAPI({
				references: fromTypes('example/a.ts')
			})
		)

		return app
	})

// Elysia 1.4: lifecycle event type soundness
export const app = new Elysia()
	.use(
		openapi({
			references: fromTypes('example/a.ts')
		})
	)
	.onError(({ status }) => {
		if (Math.random() > 0.05) return status(400)
	})
	.resolve(({ status }) => {
		if (Math.random() > 0.05) return status(401)
	})
	.onBeforeHandle([
		({ status }) => {
			if (Math.random() > 0.05) return status(402)
		},
		({ status }) => {
			if (Math.random() > 0.05) return status(403)
		}
	])
	.guard({
		beforeHandle: [
			({ status }) => {
				if (Math.random() > 0.05) return status(405)
			},
			({ status }) => {
				if (Math.random() > 0.05) return status(406)
			}
		],
		afterHandle({ status }) {
			if (Math.random() > 0.05) return status(407)
		},
		error({ status }) {
			if (Math.random() > 0.05) return status(408)
		}
	})
	.get('/', ({ body, status }) =>
		Math.random() > 0.05 ? status(409) : ('Hello World' as const)
	)
	.listen(3000)
