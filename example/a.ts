import { Elysia, t } from '../src'

const app = new Elysia().wrap((fetch) => {
	return (request) => fetch(request)
})
