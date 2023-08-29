// import { Memoirist } from 'memoirist'
// import type {
// 	ServerWebSocket,
// 	ServerWebSocketSendStatus,
// 	WebSocketHandler
// } from 'bun'

import Elysia from "..";

// import type { Elysia, Context } from '..'

// import type { ElysiaWSContext } from './types'
// import { ValidationError } from '../error'

// const getPath = (url: string) => {
// 	const start = url.indexOf('/', 10)
// 	const end = url.indexOf('?', start)

// 	if (end === -1) return url.slice(start)

// 	return url.slice(start, end)
// }

// export class ElysiaWS<WS extends ElysiaWSContext> {
// 	raw: WS
// 	data: WS['data']
// 	isSubscribed: WS['isSubscribed']

// 	constructor(ws: WS) {
// 		this.raw = ws
// 		this.data = ws.data
// 		this.isSubscribed = ws.isSubscribed
// 	}

// 	publish(
// 		topic: string,
// 		data: WS['data']['schema']['response'] = undefined as any,
// 		compress?: boolean
// 	) {
// 		// @ts-ignore
// 		if (typeof data === 'object') data = JSON.stringify(data)

// 		this.raw.publish(topic, data as unknown as string, compress)

// 		return this
// 	}

// 	publishToSelf(
// 		topic: string,
// 		data: WS['data']['schema']['response'] = undefined as any,
// 		compress?: boolean
// 	) {
// 		// @ts-ignore
// 		if (typeof data === 'object') data = JSON.stringify(data)

// 		this.raw.publish(topic, data as unknown as string, compress)

// 		return this
// 	}

// 	send(data: WS['data']['schema']['response']) {
// 		// @ts-ignore
// 		if (typeof data === 'object') data = JSON.stringify(data)

// 		this.raw.send(data as unknown as string)

// 		return this
// 	}

// 	subscribe(room: string) {
// 		this.raw.subscribe(room)

// 		return this
// 	}

// 	unsubscribe(room: string) {
// 		this.raw.unsubscribe(room)

// 		return this
// 	}

// 	cork(callback: (ws: ServerWebSocket<any>) => any) {
// 		this.raw.cork(callback)

// 		return this
// 	}

// 	close() {
// 		this.raw.close()

// 		return this
// 	}
// }

// /**
//  * Register websocket config for Elysia
//  *
//  * ---
//  * @example
//  * ```typescript
//  * import { Elysia } from 'elysia'
//  * import { websocket } from '@elysiajs/websocket'
//  *
//  * const app = new Elysia()
//  *     .use(websocket())
//  *     .ws('/ws', {
//  *         message: () => "Hi"
//  *     })
//  *     .listen(8080)
//  * ```
//  */

export const ws = () => new Elysia()

// export const ws =
// 	(config?: Omit<WebSocketHandler, 'open' | 'message' | 'close' | 'drain'>) =>
// 	(app: Elysia) => {
// 		// @ts-ignore
// 		if (!app.wsRouter) app.wsRouter = new Memoirist()

// 		// @ts-ignore
// 		const router = app.wsRouter!

// 		if (!app.config.serve)
// 			app.config.serve = {
// 				websocket: {
// 					...config,
// 					open(ws) {
// 						if (!ws.data) return

// 						const url = getPath(
// 							(ws?.data as unknown as Context).request.url
// 						)

// 						if (!url) return

// 						const route = router.find('subscribe', url)?.store

// 						if (route && route.open)
// 							route.open(new ElysiaWS(ws as any))
// 					},
// 					message(ws, message: any): void {
// 						if (!ws.data) return

// 						const url = getPath(
// 							(ws?.data as unknown as Context).request.url
// 						)

// 						if (!url) return

// 						const route = router.find('subscribe', url)?.store
// 						if (!route?.message) return

// 						message = message.toString()
// 						const start = message.charCodeAt(0)

// 						if (start === 47 || start === 123)
// 							try {
// 								message = JSON.parse(message)
// 							} catch (error) {
// 								// Not empty
// 							}
// 						else if (!Number.isNaN(+message)) message = +message

// 						for (
// 							let i = 0;
// 							i <
// 							(ws.data as ElysiaWSContext['data'])
// 								.transformMessage.length;
// 							i++
// 						) {
// 							const temp: any = (
// 								ws.data as ElysiaWSContext['data']
// 							).transformMessage[i](message)

// 							if (temp !== undefined) message = temp
// 						}

// 						if (
// 							(ws.data as ElysiaWSContext['data']).message?.Check(
// 								message
// 							) === false
// 						)
// 							return void ws.send(
// 								new ValidationError(
// 									'message',
// 									(ws.data as ElysiaWSContext['data'])
// 										.message as any,
// 									message
// 								).cause as string
// 							)

// 						route.message(new ElysiaWS(ws as any), message)
// 					},
// 					close(ws, code, reason) {
// 						if (!ws.data) return

// 						const url = getPath(
// 							(ws?.data as unknown as Context).request.url
// 						)

// 						if (!url) return

// 						const route = router.find('subscribe', url)?.store

// 						if (route && route.close)
// 							route.close(new ElysiaWS(ws as any), code, reason)
// 					},
// 					drain(ws) {
// 						if (!ws.data) return

// 						const url = getPath(
// 							(ws?.data as unknown as Context).request.url
// 						)

// 						if (!url) return

// 						const route = router.find('subscribe', url)?.store

// 						if (route && route.drain)
// 							route.drain(new ElysiaWS(ws as any))
// 					}
// 				}
// 			}

// 		return app
// 			.decorate('publish', app.server?.publish as WSPublish)
// 			.onStart((app) => {
// 				// @ts-ignore
// 				app.decorators.publish = app.server?.publish
// 			})
// 	}

// type WSPublish = (
// 	topic: string,
// 	data: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer,
// 	compress?: boolean
// ) => ServerWebSocketSendStatus

// export type {
// 	WSTypedSchema,
// 	WebSocketHeaderHandler,
// 	WebSocketSchemaToRoute,
// 	ElysiaWSContext,
// 	ElysiaWSOptions,
// 	TransformMessageHandler
// } from './types'
