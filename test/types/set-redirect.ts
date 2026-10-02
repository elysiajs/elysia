import { Elysia } from '../../src'

// `set.redirect` was removed in 2.0 (a 1.x auth guard writing it serves the
// body it meant to protect in production). The key stays declared as a
// deprecated `never` so editors strike it through with the migration hint
// instead of reporting an unknown property
new Elysia()
	.request(({ set }) => {
		// @ts-expect-error a URL is not assignable to the removed key
		set.redirect = '/login'
		set.redirect satisfies undefined
	})
	.beforeHandle(({ set }) => {
		// @ts-expect-error a URL is not assignable to the removed key
		set.redirect = '/login'
		set.redirect satisfies undefined
	})
	.error(({ set }) => {
		// @ts-expect-error a URL is not assignable to the removed key
		set.redirect = '/login'
	})
	.get('/', ({ set, redirect }) => {
		// @ts-expect-error a URL is not assignable to the removed key
		set.redirect = '/login'
		set.redirect satisfies undefined

		return redirect('/login')
	})
