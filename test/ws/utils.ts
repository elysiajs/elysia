import type { Server } from 'bun'

export const newWebsocket = (server: Server<any>, path = '/ws') =>
	new WebSocket(`ws://${server.hostname}:${server.port}${path}`, {})

export const wsUpgrade = (server: Server<any>, path = '/ws') =>
	fetch(`http://${server.hostname}:${server.port}${path}`, {
		headers: {
			upgrade: 'websocket',
			connection: 'Upgrade',
			'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
			'sec-websocket-version': '13'
		}
	})

export const wsOpen = (ws: WebSocket) =>
	new Promise((resolve) => {
		// The socket may open before the caller starts waiting.
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
