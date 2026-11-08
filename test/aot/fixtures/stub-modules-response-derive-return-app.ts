import { Elysia, t } from '../../../src'

// The derive reads nothing: it returns a replacement `set` carrying a cookie,
// merged into the context
export const app = new Elysia().guard({}, (app) =>
	app
		.derive(() => ({
			set: { status: 200, headers: {}, cookie: { seen: { value: '1' } } }
		}))
		.get('/', { response: t.String({ minLength: 1 }) }, () => 'ok')
)
