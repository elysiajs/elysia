import { Elysia, form, t } from '../src'
import { mapResponse } from '../src/adapter/bun/handler'

const response = mapResponse(
	form({
		a: Bun.file('test/kyuukurarin.mp4')
	}),
	{
		status: 200,
		headers: {}
	}
)

console.log((await response.formData()) instanceof FormData)
