import { Elysia } from '../../../src'

// Static paths, no schema, no query / cookie / set: every module stub applies.
// The hook-only route still passes its hook through the snapshot stub
export const app = new Elysia()
	.get('/', 'Hello World')
	.get('/hook', { beforeHandle() {} }, () => 'hooked')
