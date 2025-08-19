import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia().get('/', ({ headers }) => typeof headers['is-admin'], {
	headers: t.Object({
		'is-admin': t.Union([
			t.Boolean(),
			t.String({
				format: 'boolean'
			})
		])
	})
})

const value = await app
	.handle(
		req('/', {
			headers: {
				'is-admin': 'true'
			}
		})
	)
	.then((x) => x.text())
