import { Elysia, t } from '../../../src'
import { BunAdapter } from '../../../src/adapter/bun'

// A custom adapter's mapper writes `set.cookie` before the Bun mapper runs
export const app = new Elysia({
	adapter: {
		...BunAdapter,
		response: {
			...BunAdapter.response,
			map(response, set, request, owned) {
				set.cookie = { seen: { value: '1' } }
				return BunAdapter.response.map(response, set, request, owned)
			}
		}
	}
}).get('/', { response: t.String({ minLength: 1 }) }, () => 'ok')
