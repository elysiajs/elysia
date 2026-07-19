import type { Serve as BunServe, Server as BunServer } from 'bun'
import type { Equal, MaybePromise } from '../types'

export interface ErrorLike extends Error {
	code?: string
	errno?: number
	syscall?: string
}

export interface GenericServeOptions {
	/**
	 * Maximum request body size in bytes.
	 * @default 1024 * 1024 * 128 // 128MB
	 */
	maxRequestBodySize?: number

	/**
	 * Render Bun's contextual error page.
	 * @default process.env.NODE_ENV !== 'production'
	 */
	development?: boolean

	error?: (
		this: Server,
		request: ErrorLike
	) => Response | Promise<Response> | undefined | Promise<undefined>

	/** Server ID used for hot reloading; `null` disables hot reloading. */
	id?: string | null
}

export interface ServeOptions extends GenericServeOptions {
	/** Listening port. @default process.env.PORT || "3000" */
	port?: string | number

	/**
	 * Enable `SO_REUSEPORT` so multiple processes may bind to the port.
	 * @default false
	 */
	reusePort?: boolean

	/** Listening hostname without a port. @default "0.0.0.0" */
	hostname?: string

	/** Listen on a Unix socket instead of a hostname and port. */
	unix?: never

	/** Handle HTTP requests. */
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
	/** Client IP address. */
	address: string
	/** Client port. */
	port: number
	/** Client IP family. */
	family: 'IPv4' | 'IPv6'
}

export interface ServerOptions extends Disposable {
	/** Stop accepting connections; `true` also terminates active requests and WebSockets. @default false */
	stop(closeActiveConnections?: boolean): void

	/** Replace `fetch` and `error` without restarting; other options are ignored. */
	reload(options: Serve): void

	/** Call the running server's fetch handler; URL and error handling may differ from live requests. */
	fetch(request: Request | string): Response | Promise<Response>

	/**
	 * Upgrade a request to a WebSocket and optionally attach headers or data.
	 * @returns Whether the upgrade succeeded.
	 */
	upgrade<T = undefined>(
		request: Request,
		options?: {
			/** Additional upgrade headers, such as cookies. */
			headers?: Bun.HeadersInit
			/** Value exposed as {@link ServerWebSocket.data}. */
			data?: T
		}
	): boolean

	/**
	 * Publish data to WebSockets subscribed to a topic.
	 * @returns Dropped (`0`), backpressure (`-1`), or bytes sent.
	 */
	publish(
		topic: string,
		data: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer,
		compress?: boolean
	): ServerWebSocketSendStatus

	/** Return the client address, or `null` for closed requests and Unix sockets. */
	requestIP(request: Request): SocketAddress | null

	/** Reset a request's idle timeout in seconds; `0` disables it. */
	timeout(request: Request, seconds: number): void

	/** Keep the process alive while this server is active. */
	ref(): void

	/** Allow the process to exit when this server is the only active handle. */
	unref(): void

	/** In-flight request count. */
	readonly pendingRequests: number

	/** In-flight WebSocket count. */
	readonly pendingWebSockets: number

	readonly url: URL

	readonly port: number
	/** Listening hostname without the port. */
	readonly hostname: string
	/** Whether development error pages are enabled; stack traces may expose sensitive data. */
	readonly development: boolean

	/** Server instance identifier. */
	readonly id: string
}

export type ListenCallback = (server: Server) => MaybePromise<void>
