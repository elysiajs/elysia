import { Elysia } from 'elysia'

// Slim-replay slice-2 candidate: loose (strictPath off) + autoHead, static and
// schema-free. A composed sub-app keeps handlers captured (not inlined). Loose
// derives trailing-slash aliases and autoHead adds a wrapped HEAD table — both
// serialized into `Compiled.routeTable` while the app still seals by construction.
const child = new Elysia().get('/a/', () => 'a')

export const app = new Elysia({ autoHead: true })
	.use(child)
	.get('/', () => 'root')
	.get('/b', () => 'b')
