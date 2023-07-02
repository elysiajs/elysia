import { Elysia, t } from '../src'

const app = new Elysia()
	.get('/', () => ({
		success: true,
		code: 201,
		message: 'Welcome!',
		home: 'https://cup.m1r.ai',
		github: 'https://github.com/ST4RCHASER/CRUDCup'
	}))
	.group(
		'/:cupId',
		{
			beforeHandle: ({ set, params: { cupId } }) => cupId
		},
		(cupGroup) =>
			cupGroup
				.get('/', ({ params: { cupId } }) => cupId)
				.delete('/', ({ params: { cupId } }) => cupId)
				.group(
					'/:cupId/:resourceId',
					{
						beforeHandle: ({ params: { resourceId } }) => resourceId
					},
					(app) =>
						app.get(
							'/',
							({ params: { cupId, resourceId } }) => resourceId
						)
				)
	)
	.listen(3000)
