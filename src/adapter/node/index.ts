/* eslint-disable sonarjs/no-duplicate-string */
import { createServer, type IncomingMessage } from 'node:http'
import { Readable } from 'node:stream'

import { isNumericString } from '../../utils'
import type { ElysiaAdapter } from '../types'

export const ElysiaNodeContext = Symbol('ElysiaNodeContext')

const getUrl = (req: IncomingMessage) => {
	if (req.headers.host) return `http://${req.headers.host}${req.url}`

	if (req.socket?.localPort)
		return `http://localhost:${req.socket?.localPort}${req.url}`

	return `http://localhost${req.url}`
}

export const nodeRequestToWebstand = (
	req: IncomingMessage,
	abortController: AbortController
) => {
	let _signal: AbortSignal

	return new Request(getUrl(req), {
		method: req.method,
		headers: req.headers as Record<string, string>,
		get body() {
			return req.method === 'GET' || req.method === 'HEAD'
				? undefined
				: Readable.toWeb(req)
		},
		get signal() {
			if (_signal) return _signal

			const controller = abortController ?? new AbortController()
			_signal = controller.signal

			req.once('close', () => {
				controller.abort()
			})

			return _signal
		}
	})
}

export const NodeAdapter: ElysiaAdapter = {
	composeHandler: {
		inject: {
			ElysiaNodeContext
		},
		declare: `const req = c[ElysiaNodeContext].req\n`,
		headers: `c.headers = req.headers\n`,
		parser: {
			json() {
				let fnLiteral =
					'c.body=await new Promise((resolve)=>{' +
					`body=''\n` +
					`req.on('data',(chunk)=>{body+=chunk.toString()})\n` +
					`req.on('end',()=>{`

				fnLiteral +=
					`if(body.length===0) return resolve()\n` +
					`else resolve(JSON.parse(body))`

				return fnLiteral + `})` + '})\n'
			},
			text() {
				let fnLiteral =
					'c.body=await new Promise((resolve)=>{' +
					`body=''\n` +
					`req.on('data',(chunk)=>{body+=chunk.toString()})\n` +
					`req.on('end',()=>{`

				fnLiteral +=
					`if(body.length===0) return resolve()\n` +
					`else resolve(body)`

				return fnLiteral + `})` + '})\n'
			},
			urlencoded() {
				let fnLiteral =
					'c.body=await new Promise((resolve)=>{' +
					`body=''\n` +
					`req.on('data',(chunk)=>{body+=chunk.toString()})\n` +
					`req.on('end',()=>{`

				fnLiteral +=
					`if(body.length===0) return resolve()\n` +
					`else resolve(parseQuery(body))`

				return fnLiteral + `})` + '})\n'
			},
			arrayBuffer() {
				return '\n'
			},
			formData() {
				return '\n'
			}
		}
	},
	composeGeneralHandler: {
		inject: {
			nodeRequestToWebstand,
			ElysiaNodeContext
		},
		createContext: (app) => {
			let decoratorsLiteral = ''
			let fnLiteral = 'const p=r.url\n'

			// @ts-expect-error private
			const defaultHeaders = app.setHeaders

			// @ts-ignore
			for (const key of Object.keys(app.singleton.decorator))
				decoratorsLiteral += `,${key}: app.singleton.decorator.${key}`

			const hasTrace = app.event.trace.length > 0

			if (hasTrace) fnLiteral += `const id=randomId()\n`

			fnLiteral +=
				`let _request\n` +
				`const c={` +
				`get request(){` +
				`if(_request)return _request\n` +
				`return _request = nodeRequestToWebstand(r) ` +
				`},` +
				`store,` +
				`qi: -1,` +
				`path:p,` +
				`url:r.url,` +
				`redirect,` +
				`error,`

			fnLiteral +=
				'[ElysiaNodeContext]:{' +
				'req:r,' +
				'_signal:undefined,' +
				'get signal(){' +
				'if(this._signal) return this._signal\n' +
				'const controller = new AbortController()\n' +
				'this._signal = controller.signal\n' +
				// `req.once('close', () => { controller.abort() })\n` +
				'return this._signal' +
				'}' +
				'},'

			fnLiteral += `set:{headers:`

			fnLiteral += Object.keys(defaultHeaders ?? {}).length
				? 'Object.assign({}, app.setHeaders)'
				: '{}'

			fnLiteral += `,status:200}`

			// @ts-expect-error private
			if (app.inference.server)
				fnLiteral += `,get server(){return getServer()}`
			if (hasTrace) fnLiteral += ',[ELYSIA_REQUEST_ID]:id'

			fnLiteral += decoratorsLiteral
			fnLiteral += `}\n`

			return fnLiteral
		},
		websocket() {
			return '\n'
		}
	},
	listen(app) {
		return (options, callback) => {
			app.compile()

			if (typeof options === 'string') {
				if (!isNumericString(options))
					throw new Error('Port must be a numeric value')

				options = parseInt(options)
			}

			const server = createServer(async (req, res) => {
				const response = await app.fetch(req as any)

				for (const [name, value] of Object.entries(response.headers))
					res.setHeader(name, value)

				res.writeHead(response.status)
				res.end(await response.text())
			}).listen(options, () => {
				if (callback)
					// @ts-ignore
					callback()
			})

			for (let i = 0; i < app.event.start.length; i++)
				app.event.start[i].fn(this)

			process.on('beforeExit', () => {
				server.close()

				for (let i = 0; i < app.event.stop.length; i++)
					app.event.stop[i].fn(this)
			})
		}
	}
}
