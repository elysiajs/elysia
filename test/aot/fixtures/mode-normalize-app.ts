import { Elysia } from 'elysia'

// normalize:'typebox' app with NO schema validators (schema-less GET routes
// only). Without the explicit routesForbidSeal gate in planFromReport the gate
// would see: handlers=1, validators=0/0, [].every(...)=true → allBridgeFree=true
// → sealed. But frozen-validator.ts:339 refuses every hook under normalize:'typebox'
// (Clean path routes through live TypeBox), so a sealed/severed bridge would
// 500 on the first request with "Typebox module isn't initialized".
// The explicit normalize gate must block this false-seal.
export const app = new Elysia({ normalize: 'typebox' })
	.get('/', () => 'hi')
	.get('/health', () => ({ ok: true }))
