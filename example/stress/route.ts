import { Elysia } from '../../src/2'
import { profile } from './utils'

const app = new Elysia()

const total = 100_000
const stop = profile('Elysia 2α add route x100k + fetch once')

for (let i = 0; i < total; i++) app.get(`/${i}`, () => 'ok')

// full build
// app.handle('/0')

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
