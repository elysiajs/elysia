import { Elysia } from 'elysia'
import { profile } from './utils'

const end = profile('q')

const app = new Elysia()

for (let i = 0; i < 100_000; i++) app.get(`/${i}`, () => i)

await app
	.handle('/')
	.then((r) => r.text())
	.then(console.log)

end()
