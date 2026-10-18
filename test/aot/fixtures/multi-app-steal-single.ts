import { Elysia } from '../../../src'

// `sub.fetch` builds the unnamed sub-app's router at import, before `app`: it
// claims the one unnamed manifest, so `app` fails at its first build
const sub = new Elysia().get('/hello', () => 'sub')

export const app = new Elysia().mount('/x', sub.fetch).get('/', () => 'root')
