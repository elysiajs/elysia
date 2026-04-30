import { Elysia } from '../../src/2'
import { profile } from './utils'

const total = 100_000
const plugins = new Array(total)

for (let i = 0; i < total; i++)
	plugins[i] = new Elysia().get(`/${i}`, () => 'ok')

const stop = profile('Elysia 2α start 100k plugins w/ 1 route')
const app = new Elysia()

for (let i = 0; i < total; i++)
	app.use(plugins[i])

app.handle('/0')
stop()

// await handler({
// 	set: {
// 		status: 200,
// 		headers: {}
// 	},
// 	request: new Request('http://localhost?a=b', {
// 		method: 'GET',
// 		headers: {
// 			'content-type': 'application/json'
// 		},
// 		body: JSON.stringify([
// 			{
// 				name: 'q'
// 			}
// 		])
// 	})
// })
// 	.then((res) => res.text())
// 	.then(console.log)
