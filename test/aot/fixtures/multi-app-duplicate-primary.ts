import { Elysia } from '../../../src'

// A secondary reusing the primary's name
export const app = new Elysia({ name: 'svc' }).get('/', () => 'ok')
export const other = new Elysia({ name: 'svc', seed: 1 }).get('/b', () => 'b')
