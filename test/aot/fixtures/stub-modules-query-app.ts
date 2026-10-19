import { Elysia } from '../../../src'

// A handler reading query aliases the query parser
export const app = new Elysia().get('/', ({ query }) => query.name ?? 'none')
