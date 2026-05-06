import { Elysia, t } from '../src'

let count = 0

const group = new Elysia()
	.transform('global', () => {
		count++
	})
	.get('/a', () => 'Hi')

const app = new Elysia().use(group)

await app.handle('/a')

console.log(count)
