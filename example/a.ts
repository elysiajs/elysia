import { Elysia } from '../src'

// ❌ BROKEN: Using separate instances with .use()
const typesRoutes = new Elysia({ prefix: '/types' })
	.get('/', () => 'List all types')
	.get('/:id', ({ params }) => `Get type: ${params.id}`)

const itemsRoutes = new Elysia()
	.get('/', () => 'List all items')
	.get('/:id', ({ params }) => `Get item: ${params.id}`)

const brokenModule = new Elysia({ prefix: '/items' })
	.use(typesRoutes) // Static prefix - should match first
	.use(itemsRoutes) // Has /:id catch-all

const typesRoutesNoPrefix = new Elysia()
	.get('/', () => 'List all types')
	.get('/:id', ({ params }) => `Get type: ${params.id}`)

const brokenModuleWithGroup = new Elysia({ prefix: '/items' })
	.group('/types', (app) => app.use(typesRoutesNoPrefix))
	.use(itemsRoutes)

// ✅ WORKS: All routes in single instance
const workingModule = new Elysia({ prefix: '/items' })
	.get('/:id', ({ params }) => `Get item: ${params.id}`)
	.get('/', () => 'List all items')
	.get('/types', () => 'List all types')
	.get('/types/:id', ({ params }) => `Get type: ${params.id}`)

const work = new Elysia({ systemRouter: true })
	.use(workingModule) // GET /items/types returns "List all types" ✅
	// .listen(3000)

const notWork = new Elysia({ systemRouter: true })
	.use(brokenModule) // GET /items/types returns "Get item: types" ❌
	.use(brokenModuleWithGroup) // GET /items/types returns "Get item: types" ❌
	.listen(3001)

Bun.serve({
	port: 3002,
	routes: {
		'/items/types/': {
			GET: () => new Response('/items/types/')
		},
		'/items/types/:id': {
			GET: () => new Response('/items/types/:id')
		},
		'/items/:id': {
			GET: () => new Response('/items/:id')
		}
	}
})
