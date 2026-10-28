import { Elysia } from '../../../src'

// Registered after the route, the error hook only runs on the app-level path
// (404) and writes `set.cookie` there: the serializer is reached without any
// route program aliasing a cookie or set
export const app = new Elysia().get('/', 'Hello World').onError(({ set }) => {
	set.cookie = { seen: { value: '1' } }
})
