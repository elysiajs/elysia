import { Elysia } from '../../src'
import { memorySnapshot } from './utils'

const app = new Elysia().ws('/ws', {
	message(ws, message) {
		ws.send(message)
	}
})

app.listen(0)

let stopped = false
const stop = async () => {
	if (stopped) return
	stopped = true
	await app.stop(true)
}

process.on('message', async (message: any) => {
	if (message?.type === 'snapshot') {
		process.send?.({
			type: 'snapshot',
			id: message.id,
			snapshot: memorySnapshot()
		})
		return
	}

	if (message?.type === 'stop') {
		try {
			await stop()
			process.send?.({ type: 'stopped' })
		} finally {
			process.disconnect?.()
		}
	}
})

for (const signal of ['SIGINT', 'SIGTERM'] as const)
	process.once(signal, () => {
		void stop().finally(() => process.disconnect?.())
	})

process.send?.({ type: 'ready', port: app.server!.port })
