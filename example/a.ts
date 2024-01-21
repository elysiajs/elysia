import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia()
	.get('/group/with/skadi/and/stuff', 'ai')

app._types.Metadata.routes

app.handle(req('/inner'))
app.handle(req('/outer'))
