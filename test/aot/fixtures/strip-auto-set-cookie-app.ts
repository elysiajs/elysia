import { Elysia } from '../../../src'

// Writing `set.cookie` needs response serialization but not request-side cookie
// parsing, so automatic stripping may remove only the request machinery.
export const app = new Elysia().get('/manual', ({ set }) => {
	;(set as any).cookie = { token: { value: 'abc' } }
	return 'ok'
})
