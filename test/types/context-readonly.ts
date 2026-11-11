import { Elysia } from '../../src'

new Elysia().get('/readonly-path', (context) => {
	// @ts-expect-error handlers cannot rewrite the path selected by the router
	context.path = '/other'
	return context.path
})
