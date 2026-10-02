import type { Serve as BunServe, Server as BunServer } from 'bun'
import type { Equal, MaybePromise } from '../types'

export interface ErrorLike extends Error {
	code?: string
	errno?: number
	syscall?: string
}

export interface GenericServeOptions {
	maxRequestBodySize?: number
	development?: boolean
	error?: (
		this: Server,
		request: ErrorLike
	) => Response | Promise<Response> | undefined | Promise<undefined>
	id?: string | null
}

export interface ServeOptions extends GenericServeOptions {
	port?: string | number
	reusePort?: boolean
	hostname?: string
	unix?: never
	fetch(
		this: Server,
		request: Request,
		server: Server
	): Response | Promise<Response>
	routes: Record<
		string,
		Function | Response | Record<string, Function | Response>
	>
}

export type Serve =
	Equal<BunServe.Options<unknown>, unknown> extends false
		? BunServe.Options<unknown>
		: ServeOptions
export type Server =
	Equal<BunServer<unknown>, unknown> extends false
		? BunServer<unknown>
		: ServerOptions

export type ServerWebSocketSendStatus = number

export interface SocketAddress {
	address: string
	port: number
	family: 'IPv4' | 'IPv6'
}

export interface ServerOptions extends Disposable {
	stop(closeActiveConnections?: boolean): void
	reload(options: Serve): void
	fetch(request: Request | string): Response | Promise<Response>
	upgrade<T = undefined>(
		request: Request,
		options?: {
			headers?: Bun.HeadersInit
			data?: T
		}
	): boolean
	publish(
		topic: string,
		data: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer,
		compress?: boolean
	): ServerWebSocketSendStatus
	requestIP(request: Request): SocketAddress | null
	timeout(request: Request, seconds: number): void
	ref(): void
	unref(): void
	readonly pendingRequests: number
	readonly pendingWebSockets: number
	readonly url: URL
	readonly port: number
	readonly hostname: string
	readonly development: boolean
	readonly id: string
}

export type ListenCallback = (server: Server) => MaybePromise<void>
