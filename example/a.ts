import { Equal } from '@sinclair/typebox/value'
import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia()
	.get(
		'/',
		({ status }) => {
			// this one is ok
			return status(401, { error: 'Unauthorized' })
		},
		{
			beforeHandle: ({ status }) => {
				return status(401, { error: 'Unauthorized' })
			},
			response: {
				401: t.Object({
					error: t.String()
				})
			}
		}
	)
	.state('a', 'b')
