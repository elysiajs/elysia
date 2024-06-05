import { mapResponse } from '../dist'
import { Elysia } from '../src'
import { req } from '../test/utils'

class CustomClass {
	constructor(public name: string) {}
}

const app = new Elysia({ precompile: true })
	.trace(() => {})
	.onError(() => new CustomClass('aru'))
	.mapResponse(({ response }) => {
		if (response instanceof CustomClass) return new Response(response.name)
	})
	.get('/', () => {
		throw new Error('Hello')
	})
	.compile()

app.handle(req('/'))
	.then((x) => x.text())
	.then(console.log)

// console.log(headers.get('name'))
