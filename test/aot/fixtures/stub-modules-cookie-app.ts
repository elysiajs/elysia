import { Elysia } from '../../../src'

// Reading the jar keeps the Cookie class and its serializer
export const app = new Elysia().get('/', ({ cookie: { name } }) => {
	name.value = 'set'
	return 'ok'
})
