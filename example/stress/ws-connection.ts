import { Elysia } from '../../src'
import { gc, memoryUsage } from './utils'

const app = new Elysia().ws('/ws', {
	message(ws, message) {
		ws.send(message)
	}
})

app.listen(0)
const port = app.server!.port
const url = `ws://localhost:${port}/ws`

const total = 2_000

const openAll = () =>
	Promise.all(
		Array.from(
			{ length: total },
			() =>
				new Promise<WebSocket>((resolve, reject) => {
					const ws = new WebSocket(url)
					ws.onopen = () => resolve(ws)
					ws.onerror = (e) => reject(e)
				})
		)
	)

gc()
const m1 = memoryUsage()
const t1 = performance.now()

const sockets = await openAll()

const upgradeMs = performance.now() - t1
gc()
const m2 = memoryUsage()

console.log(`WebSocket: ${total} concurrent connections`)
console.log(
	'Upgrade:',
	upgradeMs.toFixed(2),
	'ms  (',
	((upgradeMs / total) * 1000).toFixed(1),
	'us/conn )'
)
console.log(
	'Retained:',
	((m2 - m1) / 1024 / 1024).toFixed(2),
	'MB  (',
	((m2 - m1) / total).toFixed(1),
	'bytes/conn )'
)

for (const ws of sockets) ws.close()
app.server!.stop?.()
