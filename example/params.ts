import { Elysia } from '../src'

const app = new Elysia()
  .get('/', () => 'Elysia')
  // Retrieve params, automatically typed
  .get('/id/:id', ({ params }) => params.id)
  .listen(8080)

console.log('Listen')
