import { Elysia, t } from '../src'

new Elysia()
	.post('/', ({ body }) => body, {
		body: t.Uint8Array()
	})
	.listen(3000)

const response = await fetch('http://localhost:3000', {
	method: 'POST',
	body: new Uint8Array([
		229, 143, 175, 230, 132, 155, 227, 129, 143, 227, 129, 166, 227, 129,
		148, 227, 130, 129, 227, 130, 147
	]),
	headers: { 'content-type': 'application/octet-stream' }
})

console.log(response.status)
console.log(await response.text())
