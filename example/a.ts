import { Elysia, MaybeArray, status, t } from '../src'

const app = new Elysia()
	.guard({
	})
	.get('/', ({ headers, body, cookie, params, query }) => {
		return 'Hello World' as const
	})
