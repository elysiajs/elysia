import { t } from '../../src/2/type'
import { Elysia } from '../../src/2'
import { Validator } from '../../src/2/schema/validator'
import { profile } from './utils'

const total = 100_000
const plugins = new Array(total)

const stop = profile('Elysia 2α apply 100k plugins w/ 1 route')

for (let i = 0; i < total; i++)
	plugins.push(new Elysia().get(`/${i}`, () => 'ok'))

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
