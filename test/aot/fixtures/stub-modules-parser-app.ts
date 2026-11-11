import { Elysia } from '../../../src'

// A named built-in parser reads the adapter body-parse table without a schema
export const app = new Elysia().post('/', { parse: 'json' }, ({ body }) => body)
