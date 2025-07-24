import type { Serve as BunServe, Server as BunServer } from 'bun'
import type { IsAny, MaybePromise } from '../types'

export interface ErrorLike extends Error {
	code?: string
	errno?: number
	syscall?: string
}

export interface GenericServeOptions {
	/**
	 * What URI should be used to make {@link Request.url} absolute?
	 *
	 * By default, looks at {@link hostname}, {@link port}, and whether or not SSL is enabled to generate one
	 *
	 * @example
	 * ```js
	 * "http://my-app.com"
	 * ```
	 *
	 * @example
	 * ```js
	 * "https://wongmjane.com/"
	 * ```
	 *
	 * This should be the public, absolute URL – include the protocol and {@link hostname}. If the port isn't 80 or 443, then include the {@link port} too.
	 *
	 * @example
	 * "http://localhost:3000"
	 */
	// baseURI?: string;

	/**
	 * What is the maximum size of a request body? (in bytes)
	 * @default 1024 * 1024 * 128 // 128MB
	 */
	maxRequestBodySize?: number

	/**
	 * Render contextual errors? This enables bun's error page
	 * @default process.env.NODE_ENV !== 'production'
	 */
	development?: boolean

	error?: (
		this: Server,
		request: ErrorLike
	) => Response | Promise<Response> | undefined | Promise<undefined>

	/**
	 * Uniquely identify a server instance with an ID
	 *
	 * ### When bun is started with the `--hot` flag
	 *
	 * This string will be used to hot reload the server without interrupting
	 * pending requests or websockets. If not provided, a value will be
	 * generated. To disable hot reloading, set this value to `null`.
	 *
	 * ### When bun is not started with the `--hot` flag
	 *
	 * This string will currently do nothing. But in the future it could be useful for logs or metrics.
	 */
	id?: string | null
}

export interface ServeOptions extends GenericServeOptions {
	/**
	 * What port should the server listen on?
	 * @default process.env.PORT || "3000"
	 */
	port?: string | number

	/**
	 * If the `SO_REUSEPORT` flag should be set.
	 *
	 * This allows multiple processes to bind to the same port, which is useful for load balancing.
	 *
	 * @default false
	 */
	reusePort?: boolean

	/**
	 * What hostname should the server listen on?
	 *
	 * @default
	 * ```js
	 * "0.0.0.0" // listen on all interfaces
	 * ```
	 * @example
	 *  ```js
	 * "127.0.0.1" // Only listen locally
	 * ```
	 * @example
	 * ```js
	 * "remix.run" // Only listen on remix.run
	 * ````
	 *
	 * note: hostname should not include a {@link port}
	 */
	hostname?: string

	/**
	 * If set, the HTTP server will listen on a unix socket instead of a port.
	 * (Cannot be used with hostname+port)
	 */
	unix?: never

	/**
	 * Handle HTTP requests
	 *
	 * Respond to {@link Request} objects with a {@link Response} object.
	 */
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

export type Serve = IsAny<BunServe> extends false ? BunServe : ServeOptions
export type Server = IsAny<BunServer> extends false ? BunServer : ServerOptions

export type ServerWebSocketSendStatus = number

export interface SocketAddress {
	/**
	 * The IP address of the client.
	 */
	address: string
	/**
	 * The port of the client.
	 */
	port: number
	/**
	 * The IP family ("IPv4" or "IPv6").
	 */
	family: 'IPv4' | 'IPv6'
}

export interface ServerOptions extends Disposable {
	/**
	 * Stop listening to prevent new connections from being accepted.
	 *
	 * By default, it does not cancel in-flight requests or websockets. That means it may take some time before all network activity stops.
	 *
	 * @param closeActiveConnections Immediately terminate in-flight requests, websockets, and stop accepting new connections.
	 * @default false
	 */
	stop(closeActiveConnections?: boolean): void

	/**
	 * Update the `fetch` and `error` handlers without restarting the server.
	 *
	 * This is useful if you want to change the behavior of your server without
	 * restarting it or for hot reloading.
	 *
	 * @example
	 *
	 * ```js
	 * // create the server
	 * const server = Bun.serve({
	 *  fetch(request) {
	 *    return new Response("Hello World v1")
	 *  }
	 * });
	 *
	 * // Update the server to return a different response
	 * server.reload({
	 *   fetch(request) {
	 *     return new Response("Hello World v2")
	 *   }
	 * });
	 * ```
	 *
	 * Passing other options such as `port` or `hostname` won't do anything.
	 */
	reload(options: Serve): void

	/**
	 * Mock the fetch handler for a running server.
	 *
	 * This feature is not fully implemented yet. It doesn't normalize URLs
	 * consistently in all cases and it doesn't yet call the `error` handler
	 * consistently. This needs to be fixed
	 */
	fetch(request: Request | string): Response | Promise<Response>

	/**
	 * Upgrade a {@link Request} to a {@link ServerWebSocket}
	 *
	 * @param request The {@link Request} to upgrade
	 * @param options Pass headers or attach data to the {@link ServerWebSocket}
	 *
	 * @returns `true` if the upgrade was successful and `false` if it failed
	 *
	 * @example
	 * ```js
	 * import { serve } from "bun";
	 *  serve({
	 *    websocket: {
	 *      open: (ws) => {
	 *        console.log("Client connected");
	 *      },
	 *      message: (ws, message) => {
	 *        console.log("Client sent message", message);
	 *      },
	 *      close: (ws) => {
	 *        console.log("Client disconnected");
	 *      },
	 *    },
	 *    fetch(req, server) {
	 *      const url = new URL(req.url);
	 *      if (url.pathname === "/chat") {
	 *        const upgraded = server.upgrade(req);
	 *        if (!upgraded) {
	 *          return new Response("Upgrade failed", { status: 400 });
	 *        }
	 *      }
	 *      return new Response("Hello World");
	 *    },
	 *  });
	 * ```
	 *  What you pass to `data` is available on the {@link ServerWebSocket.data} property
	 */
	upgrade<T = undefined>(
		request: Request,
		options?: {
			/**
			 * Send any additional headers while upgrading, like cookies
			 */
			headers?: Bun.HeadersInit
			/**
			 * This value is passed to the {@link ServerWebSocket.data} property
			 */
			data?: T
		}
	): boolean

	/**
	 * Send a message to all connected {@link ServerWebSocket} subscribed to a topic
	 *
	 * @param topic The topic to publish to
	 * @param data The data to send
	 * @param compress Should the data be compressed? Ignored if the client does not support compression.
	 *
	 * @returns 0 if the message was dropped, -1 if backpressure was applied, or the number of bytes sent.
	 *
	 * @example
	 *
	 * ```js
	 * server.publish("chat", "Hello World");
	 * ```
	 *
	 * @example
	 * ```js
	 * server.publish("chat", new Uint8Array([1, 2, 3, 4]));
	 * ```
	 *
	 * @example
	 * ```js
	 * server.publish("chat", new ArrayBuffer(4), true);
	 * ```
	 *
	 * @example
	 * ```js
	 * server.publish("chat", new DataView(new ArrayBuffer(4)));
	 * ```
	 */
	publish(
		topic: string,
		data: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer,
		compress?: boolean
	): ServerWebSocketSendStatus

	/**
	 * Returns the client IP address and port of the given Request. If the request was closed or is a unix socket, returns null.
	 *
	 * @example
	 * ```js
	 * export default {
	 *  async fetch(request, server) {
	 *    return new Response(server.requestIP(request));
	 *  }
	 * }
	 * ```
	 */
	requestIP(request: Request): SocketAddress | null

 	/**
     * Reset the idleTimeout of the given Request to the number in seconds. 0 means no timeout.
     *
     * @example
     * ```js
     * export default {
     *  async fetch(request, server) {
     *    server.timeout(request, 60);
     *    await Bun.sleep(30000);
     *    return new Response("30 seconds have passed");
     *  }
     * }
     * ```
     */
    timeout(request: Request, seconds: number): void;

	/**
	 * Undo a call to {@link Server.unref}
	 *
	 * If the Server has already been stopped, this does nothing.
	 *
	 * If {@link Server.ref} is called multiple times, this does nothing. Think of it as a boolean toggle.
	 */
	ref(): void

	/**
	 * Don't keep the process alive if this server is the only thing left.
	 * Active connections may continue to keep the process alive.
	 *
	 * By default, the server is ref'd.
	 *
	 * To prevent new connections from being accepted, use {@link Server.stop}
	 */
	unref(): void

	/**
	 * How many requests are in-flight right now?
	 */
	readonly pendingRequests: number

	/**
	 * How many {@link ServerWebSocket}s are in-flight right now?
	 */
	readonly pendingWebSockets: number

	readonly url: URL

	readonly port: number
	/**
	 * The hostname the server is listening on. Does not include the port
	 * @example
	 * ```js
	 * "localhost"
	 * ```
	 */
	readonly hostname: string
	/**
	 * Is the server running in development mode?
	 *
	 * In development mode, `Bun.serve()` returns rendered error messages with
	 * stack traces instead of a generic 500 error. This makes debugging easier,
	 * but development mode shouldn't be used in production or you will risk
	 * leaking sensitive information.
	 */
	readonly development: boolean

	/**
	 * An identifier of the server instance
	 *
	 * When bun is started with the `--hot` flag, this ID is used to hot reload the server without interrupting pending requests or websockets.
	 *
	 * When bun is not started with the `--hot` flag, this ID is currently unused.
	 */
	readonly id: string
}

export type ListenCallback = (server: Server) => MaybePromise<void>
