import { Elysia, t } from '../src'
import { upload } from '../test/utils'

const app = new Elysia().post('/pass1', ({ body: { file } }) => file.size, {
	body: t.Object({
		file: t.File({
			type: 'image/*'
		})
	})
})

{
	const { request, size } = upload('/pass1', {
		file: 'millenium.jpg'
	})

	const response = await app.handle(request).then((r) => r.text())
	console.log(response)
}
