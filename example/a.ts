import { Elysia, t } from '../src'
import { post } from '../test/utils'

const app = new Elysia()
	.trace(async ({ parse, set }) => {
		const { children } = await parse
		const names = []

		for (const child of children) {
			const { name } = await child
			names.push(name)
		}

		set.headers.name = names.join(', ')
	})
	.get('/', ({ body }) => body, {
		parse: [function kindred() {}]
	})
	.compile()

console.log(app.fetch.toString())