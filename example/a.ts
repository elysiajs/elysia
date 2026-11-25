import { Elysia, inAotBuild, Manifest, t } from '../src'

const app = new Elysia()
	.guard({
		derive: () => ({ b: 'b' })
	})
	.get(
		'/',
		{
			derive: () => ({ c: 'c' }),
			cookie: t.Optional(
				t.Object({
					a: t
						.Codec(t.String())
						.Decode((v) => v)
						.Encode((v) => v + '!')
				})
			)
		},
		({ cookie: { a } }) => (a.value = 'yes')
	)
	.listen(3000)
