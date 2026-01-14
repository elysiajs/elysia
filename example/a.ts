import { Elysia } from '../src'

const app = new Elysia().get('/', () => 'a').listen(3000)
