import { Elysia } from 'elysia'

// The mapDerive tag must survive capture so its result replaces the derived context.
export const app = new Elysia()
	.derive(() => ({
		original: 'from-derive'
	}))
	.mapDerive((derivatives) => ({
		...derivatives,
		mapped: 'from-map-derive'
	}))
	.get('/', ({ mapped }) => ({ mapped }))
