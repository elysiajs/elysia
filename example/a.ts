import { Elysia, t } from '../src'

const app = new Elysia().post('/', ({ body }) => body, {
	body: t.Union([
		t.Undefined(),
		t.Object({
			name: t.String(),
			job: t.String(),
			trait: t.Optional(t.String())
		})
	])
})

const res = await app.handle(
	new Request('http://localhost/', {
		method: 'POST'
	})
)

console.log(await res.text())

console.log(app.routes[0].compile().toString())
