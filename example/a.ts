import { Elysia, t } from '../src'

const main = new Elysia({ precompile: true })
	.get('/json', () => ({
		hello: 'world'
	}))
	.compile()

// console.log(main.fetch.toString())
