import { Elysia, t } from '../src'

const app2 = new Elysia<{
	path: '/steady'
	store: {}
	request: {}
	schema: {}
	error: {}
	meta: {
		schema: {}
		defs: {}
		exposed: {}
	}
}>().get('/', () => 'a')

type A = (typeof app2)['meta']['schema']

const app = new Elysia()
	.get('/', () =>
		JSON.stringify({
			success: true,
			code: 201,
			message: 'Welcome!',
			home: 'https://cup.m1r.ai',
			github: 'https://github.com/ST4RCHASER/CRUDCup'
		})
	)
	.group(
		'/:cupId',
		{
			beforeHandle: ({ set, params: { cupId } }) => cupId,
			body: t.Object({
				username: t.String()
			}),
			params: t.Object({
				cupId: t.String()
			})
		},
		(cupGroup) =>
			cupGroup
				.get('/', ({ params: { cupId } }) => cupId)
				.delete('/', ({ params: { cupId } }) => cupId)
				.group(
					'/:cupId/:resourceId',
					{
						beforeHandle: ({ params: { resourceId } }) =>
							resourceId,
						params: t.Object({
							cupId: t.String(),
							resourceId: t.String()
						})
					},
					(app) =>
						app.get(
							'/',
							({ params: { cupId, resourceId } }) => resourceId
						)
				)
	)
	.listen(3000)
