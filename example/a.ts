import { Elysia, t } from '../src'

const test2 = new Elysia()
	.group('/:example', (app) =>
		app.get(
			'/',
			({ params: { example } }) => ({
				value: example,
				type: typeof example
			}),
			{
				params: t.Object({
					example: t.Numeric()
				})
			}
		)
	)
	.listen(8081)
