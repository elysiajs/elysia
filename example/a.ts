import { Elysia, t } from '../src'

const a = new Elysia()
	.beforeHandle('global', () => {
		console.log(1)
	})
	// This should log but not implemented yet
	.guard('global', {
		beforeHandle() {
			console.log(2)
		},
		query: t.Object({
			b: t.String()
		})
	})

const app = new Elysia().use(a).get('/', () => 'ok', {
	query: t.Object({
		a: t.String()
	})
})

// should be 422
app.handle('/?a=a&b=b')
	.then((res) => res.status)
	.then(console.log)
