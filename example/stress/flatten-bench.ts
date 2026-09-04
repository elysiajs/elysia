import { Elysia } from '../../src'
import { profile } from './utils'

const depth = 1_000
const iters = 1_000

// Force fresh `routes` materialisation to exercise hook composition.
// Each app builds a new chain head, so `composeRouteHook` cannot reuse
// `flattenChainMemo` entries across iterations.
const stop = profile(`flattenChain x${iters} (depth=${depth})`)

for (let i = 0; i < iters; i++) {
	const app = new Elysia()
	for (let j = 0; j < depth; j++) app.beforeHandle('global', function fn() {})
	app.get('/r', () => 'ok')

	// Trigger hook composition via routes getter (flattens appHook chain).
	void app.routes
}

stop()
