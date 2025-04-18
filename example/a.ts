import { Elysia, t } from '../src'

new Elysia().post(
	'/',
	({ status, error }) => error('Bad Request'),
	{
		body: t.Object({
			file: t.File({
				type: 'image'
			})
		})
	}
)
