import { ElysiaRequest } from './request'
import { Readable } from 'node:stream'
import { createServer } from 'node:http'

import { Elysia } from '..'

const app = new Elysia()
	.get('/', () => 'hello')
	.post('/', ({ headers }) => {
		console.log(headers)

		return 'ok'
	})

createServer(async (req, res) => {
	let _signal: AbortSignal

	const request = new ElysiaRequest(
		'http://' + (req.headers.host ?? 'localhost') + req.url,
		{
			method: req.method,
			headers: req.headers as Record<string, string>,
			get body() {
				return req.method === 'GET' || req.method === 'HEAD'
					? undefined
					: Readable.toWeb(req)
			},
			get signal() {
				if (_signal) return _signal

				const controller = new AbortController()
				_signal = controller.signal

				req.once('close', () => {
					controller.abort()
				})
			}
		}
	)

	const response = await app.handle(request)

	for (const [name, value] of Object.entries(response.headers))
		res.setHeader(name, value)

	res.writeHead(response.status)
	res.end(await response.text())
}).listen(3000, () => {
	console.log('Listening at :3000')
})
