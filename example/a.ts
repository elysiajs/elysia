import { Elysia, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia()
	.macro(({ onBeforeHandle }) => {
		return {
			hi(a: boolean) {
				onBeforeHandle(() => {
					console.log('A')
				})
			}
		}
	})
	.get(
		'/',
		() => {
			return 'b'
		},
		{
			hi: true
		}
	)

const res = await app.handle(req('/')).then((r) => r.text())
