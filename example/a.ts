import { Elysia, t } from '../src'

const thing = new Elysia()

const server = new Elysia()
	.use(process.env.NODE_ENV === 'development' && thing)
	.get(
		'/',
		({ query }) => {
			return query
		},

		{
			query: t.Union([
				t.Object({
					q1: t.String(),
					q2: t.Optional(t.String())
				}),
				t.Object({
					q1: t.Optional(t.String()),
					q2: t.String()
				})
			])
		}
	)
	.listen(3000)

console.log(
	await Promise.all([
		fetch('http://localhost:3000?q1=v').then((r) => r.json()),
		fetch('http://localhost:3000?q2=v').then((r) => r.json()),
		fetch('http://localhost:3000?q1=v&q2=v').then((r) => r.json()),
		fetch('http://localhost:3000?q1=v&q2=v&q3=v').then((r) => r.json()),
		fetch('http://localhost:3000').then((r) => r.json()),
		fetch('http://localhost:3000?q3').then((r) => r.json())
	])
)
