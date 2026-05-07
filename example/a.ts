import { Elysia, t } from '../src'

const app = new Elysia().get(`/1`, () => 'ok')

app.handler(0, true)
app.fetch
