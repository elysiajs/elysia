import { Elysia, NotFoundError, t } from '../src'

const app = new Elysia().get('/', () => 'hi').listen(3000)
