import { Elysia } from '../../../src'

// A named secondary makes it a multi-app build, and every app in one must be
// named: an unnamed manifest is up for grabs by any unnamed app
export const api = new Elysia({ name: 'api' }).get('/a', () => 'a')

export const app = new Elysia().use(api)
