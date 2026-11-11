import { Elysia } from '../../../src'

// A multi-app build registers no unnamed manifest, so the hidden unnamed
// sub-app fails as `sub.fetch` builds it, at import
const sub = new Elysia().get('/hello', () => 'sub')

export const service = new Elysia({ name: 'service' })
	.mount('/x', sub.fetch)
	.get('/s', () => 's')

export const app = new Elysia({ name: 'app' }).get('/', () => 'root')
