import { Elysia, file, form, t } from '../src'

const app = new Elysia()
	.ws('/ws', {
		upgradeData: t.Object({
			hello: t.String()
		}),
		beforeHandle() {
			return {
				hello: 'world'
			}
		},
		open(ws, data) {
			ws.send(data.hello)
		}
	})
	.listen(3000)
