import type { Server } from 'bun'

export const newWebsocket = (server: Server<any>, path = '/ws') =>
	new WebSocket(`ws://${server.hostname}:${server.port}${path}`, {})

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

type WsEvent = MessageEvent<string | Buffer>

interface Inbox {
	events: WsEvent[]
	waiters: {
		resolve: (event: WsEvent) => void
		reject: (error: Error) => void
	}[]
	closed: boolean
}

const inboxes = new WeakMap<WebSocket, Inbox>()

const inboxOf = (ws: WebSocket) => {
	let inbox = inboxes.get(ws)
	if (inbox) return inbox

	const state: Inbox = { events: [], waiters: [], closed: false }
	inboxes.set(ws, state)

	// One persistent listener per socket: messages arriving between
	// wsMessage calls are buffered instead of dropped, and stacked
	// wsMessage calls resolve in FIFO arrival order.
	ws.addEventListener('message', (event) => {
		const waiter = state.waiters.shift()
		if (waiter) waiter.resolve(event as WsEvent)
		else state.events.push(event as WsEvent)
	})

	// Reject pending waiters on close so a missing message fails fast
	// instead of hanging until the test timeout.
	ws.addEventListener('close', () => {
		state.closed = true
		for (const waiter of state.waiters.splice(0))
			waiter.reject(
				new Error('WebSocket closed while awaiting a message')
			)
	})

	return state
}

export const wsMessage = (ws: WebSocket) => {
	const inbox = inboxOf(ws)

	const buffered = inbox.events.shift()
	if (buffered) return Promise.resolve(buffered)

	if (inbox.closed || ws.readyState === WebSocket.CLOSED)
		return Promise.reject(
			new Error('WebSocket closed while awaiting a message')
		)

	return new Promise<WsEvent>((resolve, reject) => {
		inbox.waiters.push({ resolve, reject })
	})
}
