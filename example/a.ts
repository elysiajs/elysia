import { Elysia, file, problem, t } from '../src'
import { WebStandardAdapter } from '../src/adapter/web-standard'

const app = new Elysia()
	.get(
		'/',
		{
			cookie: t.Object({
				a: t.Cookie(t.String(), {
					sign: true
				})
			})
		},
		() => 'ok'
	)
	.listen(3000)
