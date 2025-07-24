import { Elysia, t } from '../src'

const main = new Elysia().get('/', 'hello').listen(3000)
