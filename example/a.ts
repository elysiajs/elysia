import { TypeCompiler } from '@sinclair/typebox/compiler'
import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia({
	experimental: {
		encodeSchema: true
	}
}).get('/', () => 'hello world', {
	response: t
		.Transform(t.String())
		.Decode((v) => v)
		.Encode(() => 'encoded')
})

app.handle(req('/'))
	.then((x) => x.json())
	.then(console.log)
