import { Elysia } from '../src'

const a = (config = {}) =>
	new Elysia({
		name: 'a',
		seed: config
	}).get('/', () => 'a')

const app = new Elysia().use(a()).listen(3000)

await app.modules

console.log(app.routes)
