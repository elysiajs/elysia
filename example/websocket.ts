Bun.serve({
	websocket: {
		message: (ws, message) => {
			ws.send(message)
		}
	},
	fetch(req, server) {
		// Upgrade to a ServerWebSocket if we can
		// This automatically checks for the `Sec-WebSocket-Key` header
		// meaning you don't have to check headers, you can just call `upgrade()`
		if (server.upgrade(req))
			// When upgrading, we return undefined since we don't want to send a Response
			return

		return new Response('Regular HTTP response')
	}
})
