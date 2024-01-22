import { Elysia } from '../src'

const app = new Elysia().get('/', 'a').post('/', 'a').get('/id/:id', 'a')
type app = typeof app

app._routes
