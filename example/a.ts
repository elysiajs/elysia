import { Elysia, inAotBuild, Manifest, t } from '../src'

const app = new Elysia()
	.get(
		'/',
		{
			cookie: t.Optional(
				t.Object({
					a: t
						.Codec(t.String())
						.Decode((v) => v)
						.Encode((v) => v + '!')
				})
			)
		},
		({ cookie: { a } }) => a.value = 'yes'
	)
	.listen(3000)
