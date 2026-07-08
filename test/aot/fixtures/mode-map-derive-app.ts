import { Elysia } from 'elysia'

// AOT fixture: app with a mapDerive hook. The mapDerive entry is stored as a
// tagged `[fn, 'mapDerive']` tuple in the derive entries array. This fixture
// verifies that the tag survives the AOT capture/bundle pipeline and the
// bundled handler still calls the function in mapDerive mode (i.e., the result
// REPLACES the context rather than being merged, so keys NOT in the map result
// are absent — see `replaceDeriveContext` in compile/handler/utils.ts).
export const app = new Elysia()
	.derive(() => ({
		original: 'from-derive'
	}))
	.mapDerive((derivatives) => ({
		...derivatives,
		mapped: 'from-map-derive'
	}))
	.get('/', ({ mapped }) => ({ mapped }))
