import type { Server } from 'bun'

export const newWebsocket = (server: Server<any>, path = '/ws') =>
	new WebSocket(`ws://${server.hostname}:${server.port}${path}`, {})

export const wsOpen = (ws: WebSocket) =>
	new Promise((resolve) => {
		// Handle the race where the socket has ALREADY opened by the time
		// this helper runs (frequent when multiple sockets are constructed
		// back-to-back). `addEventListener` queues correctly when the event
		// has already fired only if the state is now OPEN — handle that
		// case explicitly so the promise doesn't hang.
		if (ws.readyState === WebSocket.OPEN) return resolve(undefined)
		ws.onopen = resolve
	})

export const wsClose = async (ws: WebSocket) =>
	new Promise<CloseEvent>((resolve) => {
		ws.onclose = resolve
	})

export const wsClosed = async (ws: WebSocket) => {
	const closed = wsClose(ws)
	ws.close()
	await closed
}

export const wsMessage = (ws: WebSocket) =>
	new Promise<MessageEvent<string | Buffer>>((resolve) => {
		ws.onmessage = resolve
	})
