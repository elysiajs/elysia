import { Value } from '@sinclair/typebox/value'
import { Elysia, t } from '../src'
import { post, req } from '../test/utils'

const app = new Elysia().get('/', ({ query }) => query, {
	query: t.Object({
		name: t.String(),
		faction: t.String({ default: 'tea_party' })
	})
})

const value = await app
	.handle(req('/?name=nagisa'))
	.then((x) => x.json())
	.then(console.log)
