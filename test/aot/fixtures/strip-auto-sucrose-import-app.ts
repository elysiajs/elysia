import { Elysia } from '../../../src'
import { sucrose } from '../../../src/sucrose'

// `elysia/sucrose` is no longer a public subpath, but src/ws/route.ts still
// calls sucrose at runtime, so the JIT strip may only drop memory's
// cache-flush edge and must leave the sucrose module itself live.
export const app = new Elysia().get('/infer', () => {
	const inference = sucrose(({ query }: any) => query, undefined)

	return `${inference.query},${inference.body}`
})
