import { Elysia, t, prefix } from '../src'
import { t as t2 } from '../dist'
import { Validator } from '../src/validator'

new Elysia()
	.model(
		prefix.capitalize('A', {
			a: t.Object({
				a: t.String()
			})
		})
	)
	.macro({
		a: {
			body: 'A.A',
			// no auto-complete but works
			beforeHandle({ body, status }) {
				if (!body.a) return status(422, 'Missing a')
			}
		}
	})
	.post(
		'/',
		{
			// this has auto-complete
			body: 'test.a'
		},
		() => 'ok'
	)
