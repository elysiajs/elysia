import { Elysia, t } from '../src'

const app = new Elysia().post('/', () => 'ok', {
	body: t.Object({
		file: t.Files({
			type: 'image'
		})
	})
})

const body = new FormData()
body.append('file', Bun.file('test/images/fake.jpg'))
body.append('file', Bun.file('test/images/kozeki-ui.webp'))

const response = await app.handle(
	new Request('http://localhost/', {
		method: 'POST',
		body
	})
)

console.log(response.status)
