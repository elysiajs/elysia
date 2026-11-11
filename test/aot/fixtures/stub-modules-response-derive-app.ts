import { Elysia, t } from '../../../src'

// A derive scoped to the route (folded into its lifecycle, not the root
// chain the 404 path runs) writes `set.cookie`
export const app = new Elysia().guard({}, (app) =>
	app
		.derive(({ set }) => {
			set.cookie = { seen: { value: '1' } }
			return { seen: true }
		})
		.get('/', { response: t.String({ minLength: 1 }) }, ({ seen }) =>
			seen ? 'ok' : 'no'
		)
)
