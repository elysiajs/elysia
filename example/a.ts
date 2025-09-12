import { Elysia } from '../src'

new Elysia().onError(({ code, error }) => {
	if (code === 'VALIDATION')
		return error.all[0].message
})
