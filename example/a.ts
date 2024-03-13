import { Elysia, t } from '../src'
import { cors } from '../../cors/src'

const app = new Elysia({ precompile: true })
	.ws('/ws', {
		open(ws) {
			ws.send('Hi')
		}
	})
	.ws('/ws/:id', {
		open(ws) {
			ws.send('Hi')
		},
		message(ws, data) {
			ws.send(data)
		}
	})
	.listen(3000)
