import { Elysia, t } from '../src'

const app = new Elysia().get(
	'/',
	() => {
		return [
			{
				id: 'testId',
				date: new Date('2025-07-11T00:00:00.000Z'),
				name: 'testName',
				needNormalize: 'yes'
			}
		]
	},
	{
		response: {
			200: t.Array(
				t.Object({
					id: t.String(),
					date: t.Date(),
					name: t.String()
				})
			)
		}
	}
)

app.handle(new Request('http://localhost:3000/'))
	.then((x) => x.json())
	.then(console.log)
