import { Elysia, t } from '../src/2'
import * as z from 'zod'

const app = new Elysia().post('/sign-in', (c) => c.body, {
	parse: 'json'
})

app.handler(0, true)
