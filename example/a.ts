import { Elysia, HTTPError, problem } from '../src'

const app = new Elysia().get('/', () => 'hello world').listen(3000)

console.log(app.routes[0].compile().toString())
