import { Elysia, t } from '../src'
const t1 = performance.now()

const app = new Elysia().ws('/', () => 'ok').listen(3000)
