import { ClientRequest } from 'http'
import { Elysia, ws, t } from '../src'

const grid = [[1]]

const app = new Elysia().use(ws()).ws('/ws', {
	body: t.Object({
		type: t.String(),
		row: t.Number(),
		col: t.Number()
	}),
	message(ws, message) {
		if (message.type === 'increment') {
			grid[message.row][message.col] += 1
		}
	},
	open(ws) {
		ws.send(grid)
	}
})
