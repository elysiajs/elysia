import { Elysia } from '../../../src'

// Two distinct exported apps share a name, so one manifest key
export const first = new Elysia({ name: 'svc' }).get('/a', () => 'a')
export const second = new Elysia({ name: 'svc', seed: 1 }).get('/b', () => 'b')

export const app = new Elysia({ name: 'app' }).get('/', () => 'ok')
