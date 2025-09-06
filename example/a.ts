import { Elysia, t } from '../src'
import { openapi as OpenAPI } from '@elysiajs/openapi'
import { fromTypes } from '@elysiajs/openapi/gen'
import { InputSchema, IsNever } from '../src/types'
import { TNumber } from '@sinclair/typebox'

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

/**
 * From T, pick a set of properties whose keys are in the union K
 */
type PickIfExists<T, K extends string> = {
	// @ts-ignore
	[P in K as P extends keyof T ? P : never]: T[P];
}

type B = PickIfExists<{ body: "A" }, 'response'>

type A = (typeof app)['~Volatile']['schema']
