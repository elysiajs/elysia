import { Elysia } from 'elysia'

// normalize:'typebox' uses live TypeBox cleaning even without route schemas, so
// these routes must remain wired.
export const app = new Elysia({ normalize: 'typebox' })
	.get('/', () => 'hi')
	.get('/health', () => ({ ok: true }))
