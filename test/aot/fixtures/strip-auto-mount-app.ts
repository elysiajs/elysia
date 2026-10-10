import { Elysia } from '../../../src'

// A mounted sub-app is a second Elysia the manifest cannot name, so the AOT
// plugin refuses this entry at build time regardless of strip mode.
const inner = new Elysia().get('/hello', () => 'from-inner')

export const app = new Elysia()
	.get('/', () => 'outer')
	.mount('/sub', inner.handle)
