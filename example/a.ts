import { Elysia, form, t } from '../src'
import { mapResponse } from '../src/adapter/bun/handler'
import { req } from '../test/utils'

const app = new Elysia().get(
	'/',
	({ query: { date } }) => {
		console.log(date)

		return date.toISOString()
	},
	{
		query: t.Object({
			date: t.Date()
		})
	}
)

app.handle(req(`/?date=2023-04-05T12:30:00+01:00`))
	.then((x) => x.text())
	.then(console.log)

// const app = new Elysia().use(plugin).listen(3000)

// console.log('Server started on http://localhost:3000')
