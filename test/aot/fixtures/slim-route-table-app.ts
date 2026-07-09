import { Elysia } from 'elysia'

// Slim-replay slice-1 candidate: strictPath, static, schema-free routes with a
// composed sub-app (so the plain handlers are captured into the manifest, not
// inlined). Every route takes the frozen fast path → sealed by construction →
// the plugin freezes `Compiled.routeTable`.
const child = new Elysia({ strictPath: true })
	.get('/a', () => 'a')
	.get('/b', () => 'b')

export const app = new Elysia({ strictPath: true })
	.use(child)
	.get('/', () => 'root')
	.get('/c', () => 'c')
