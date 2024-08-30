import { Elysia, t } from '../src'

console.log(
	new Request('http://localhost', {
		method: 'CUSTOM'
	}).method
)
