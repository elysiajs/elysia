import { Elysia, MaybeArray, status, t } from '../src'

const app = new Elysia()
	.get('/', ({ query }) => query, {
		query: t.Object({
			filter: t.Object({
				latlng: t.Object({
					within: t.Object({
						ne: t.Number(),
						sw: t.Number()
					})
				}),
				zoom: t.Object({
					equalTo: t.Number({
						minimum: 0,
						maximum: 20,
						multipleOf: 1
					})
				})
			})
		})
	})
	.listen(3000)

const filter = JSON.stringify({
	latlng: {
		within: {
			ne: 1,
			sw: 1
		}
	},
	zoom: {
		equalTo: 2
	}
})

app.handle(new Request(`http://localhost:3000/?filter=${filter}`))
	.then((x) => x.json())
	.then(console.log)

// console.log(app.routes[0].compile().toString())
