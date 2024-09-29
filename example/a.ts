import { Elysia, t } from '../src'

const numberApp = new Elysia()
	.onError(({ code }) => code)
	.get('/:entityType', ({ params: { entityType } }) => entityType, {
		params: t.Object({
			entityType: t.Number({
				minimum: 0,
				maximum: 3,
				multipleOf: 1
			})
		})
	})

const response = await numberApp.handle(
  new Request("http://localhost/999")
);

console.log(await response.status)
console.log(await response.text())

// app.handle(new Request('http://localhost'))
// 	.then((x) => x.headers.getSetCookie())
// 	.then(console.log)
