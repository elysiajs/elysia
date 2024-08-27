import { Elysia, form, mapResponse, t } from '../src'

const response = mapResponse(
	form({
		a: Bun.file('test/kyuukurarin.mp4')
	}),
	{}
)

console.log(await response.formData())
console.log(response.status)
