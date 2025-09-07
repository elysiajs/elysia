import { Elysia, t } from '../src'
import { openapi as OpenAPI } from '@elysiajs/openapi'
import { fromTypes } from '@elysiajs/openapi/gen'

const openapi = (a: any) =>
	new Elysia().use((app) => {
		app.use(
			// @ts-ignore
			OpenAPI(a)
		)

		return app
	})

// Elysia 1.4: lifecycle event type soundness
export const app = new Elysia()
	.use(
		openapi({
			references: fromTypes('example/openapi.ts')
		})
	)
	.macro({
		auth: {
			response: {
				409: t.Literal('Conflict')
			},
			beforeHandle({ status }) {
				if (Math.random() < 0.05) return status(410)
			},
			resolve: () => ({ a: 'a' })
		}
	})
	.onError(({ status }) => {
		if (Math.random() < 0.05) return status(400)
	})
	.resolve(({ status }) => {
		if (Math.random() < 0.05) return status(401)
	})
	.onBeforeHandle([
		({ status }) => {
			if (Math.random() < 0.05) return status(402)
		},
		({ status }) => {
			if (Math.random() < 0.05) return status(403)
		}
	])
	.guard({
		beforeHandle: [
			({ status }) => {
				if (Math.random() < 0.05) return status(405)
			},
			({ status }) => {
				if (Math.random() < 0.05) return status(406)
			}
		],
		afterHandle({ status }) {
			if (Math.random() < 0.05) return status(407)
		},
		error({ status }) {
			if (Math.random() < 0.05) return status(408)
		}
	})
	.post(
		'/',
		({ status }) =>
			Math.random() < 0.05 ? status(409, 'Conflict') : 'Type Soundness',
		{
			auth: true,
			response: {
				411: t.Literal('Length Required')
			}
		}
	)
	.listen(3000)

// app['~Routes']['post']['response']['409']
