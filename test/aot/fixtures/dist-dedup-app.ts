import { Elysia } from 'elysia'
import * as t from 'elysia/type'

// The bare import resolves to the dual `.mjs`/`.js` dist layout. Mixed routes
// keep the adapter path reachable while the bundle verifies one Elysia copy.
export const app = new Elysia()
	.post(
		'/u',
		{ body: t.Object({ name: t.String(), age: t.Number() }) },
		({ body }) => body
	)
	.get('/', () => 'hi')
