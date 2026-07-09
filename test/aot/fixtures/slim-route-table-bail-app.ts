import { Elysia } from 'elysia'

// Slim-replay route table BAIL fixture (slice 4): the envelope now covers schema,
// hook, and dynamic (`~router`) routes, so a plain `:id` param route no longer
// bails. This fixture uses a Standard-Schema (non-TypeBox) validator route: it
// still SEALS (no TypeBox bridge needed — the standard validator is live) and is
// fully handler-stripped, but `captureRouteTable` CONSERVATIVELY bails standard
// slots, so `Compiled.routeTable` is NOT emitted → the full router builder MUST
// stay live and serve every route through it.
const standard = {
	'~standard': {
		version: 1,
		vendor: 'slim-bail',
		validate: (value: unknown) => ({ value })
	}
}

const child = new Elysia({ strictPath: true }).get('/a', () => 'a')

export const app = new Elysia({ strictPath: true })
	.use(child)
	.get('/', () => 'root')
	.post('/s', { body: standard as any }, ({ body }: any) => body)
