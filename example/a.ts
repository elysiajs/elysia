import { Elysia, t } from '../src'

const app = new Elysia().get('/', () => 'hi').listen(8080)
