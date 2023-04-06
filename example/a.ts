import { Elysia, t } from '../src'

const app = new Elysia().get('/', () => 'Hi').listen(8080)
