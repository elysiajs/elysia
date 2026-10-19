import { Elysia } from '../../../src'
import { parseQueryFromURL } from './elysia/src/parse-query'
import { decoded } from './elysia/src/handler/fetch'

// Static routes: the query and router stubs apply to Elysia's own modules
// while the user modules at mirrored paths keep their code (both would throw
// at import if replaced)
export const app = new Elysia()
	.get('/', parseQueryFromURL())
	.get('/decoded', decoded)
