import Elysia from './index'

export interface LogEntry {
	method: string
	path: string
	status: number
	duration: number
	timestamp: Date
}

export type LoggerFunction = (entry: LogEntry) => void

export interface LoggerOptions {
	/**
	 * Custom output function for log entries
	 *
	 * @default Console logger with colored output
	 *
	 * @example
	 * ```ts
	 * logger({
	 *   output: (entry) => {
	 *     myLogger.info(`${entry.method} ${entry.path} - ${entry.status} in ${entry.duration}ms`)
	 *   }
	 * })
	 * ```
	 */
	output?: LoggerFunction
	/**
	 * Skip logging for specific paths
	 *
	 * Supports exact matches and wildcard patterns:
	 * - `'/health'` - exact match
	 * - `'/users/*'` - matches `/users/123` but not `/users/123/posts`
	 * - `'/api/**'` - matches `/api/anything/nested`
	 *
	 * @example
	 * ```ts
	 * logger({
	 *   skip: ['/health', '/metrics', '/internal/**']
	 * })
	 * ```
	 */
	skip?: string[] | ((path: string) => boolean)
	/**
	 * Enable colored output in console
	 *
	 * @default true
	 */
	colored?: boolean
}

const colors = {
	reset: '\x1b[0m',
	dim: '\x1b[2m',
	green: '\x1b[32m',
	yellow: '\x1b[33m',
	red: '\x1b[31m',
	cyan: '\x1b[36m',
	magenta: '\x1b[35m',
	white: '\x1b[37m'
} as const

const getStatusColor = (status: number): string => {
	if (status >= 500) return colors.red
	if (status >= 400) return colors.yellow
	if (status >= 300) return colors.cyan
	if (status >= 200) return colors.green
	return colors.white
}

const getMethodColor = (method: string): string => {
	switch (method) {
		case 'GET':
			return colors.green
		case 'POST':
			return colors.cyan
		case 'PUT':
			return colors.yellow
		case 'DELETE':
			return colors.red
		case 'PATCH':
			return colors.magenta
		default:
			return colors.white
	}
}

const formatDuration = (duration: number): string => {
	if (duration < 1) return `${(duration * 1000).toFixed(0)}μs`
	if (duration < 1000) return `${duration.toFixed(2)}ms`
	return `${(duration / 1000).toFixed(2)}s`
}

const padMethod = (method: string, width = 7): string =>
	method.padEnd(width, ' ')

const defaultLogger =
	(colored: boolean): LoggerFunction =>
	(entry) => {
		const { method, path, status, duration, timestamp } = entry
		const timeStr = timestamp.toLocaleTimeString()

		if (colored) {
			const methodColor = getMethodColor(method)
			const statusColor = getStatusColor(status)

			console.log(
				`${colors.dim}[${timeStr}]${colors.reset} ` +
					`${methodColor}${padMethod(method)}${colors.reset} ` +
					`${path} ` +
					`${statusColor}${status}${colors.reset} ` +
					`${colors.dim}${formatDuration(duration)}${colors.reset}`
			)
		} else {
			console.log(
				`[${timeStr}] ${method} ${path} ${status} ${formatDuration(duration)}`
			)
		}
	}

const matchPattern = (pattern: string, path: string): boolean => {
	if (!pattern.includes('*')) return pattern === path

	if (pattern.endsWith('/**')) {
		const prefix = pattern.slice(0, -3)
		return path === prefix || path.startsWith(prefix + '/')
	}

	if (pattern.endsWith('/*')) {
		const prefix = pattern.slice(0, -2)
		if (!path.startsWith(prefix + '/')) return false
		const rest = path.slice(prefix.length + 1)
		return !rest.includes('/')
	}

	if (pattern.includes('*')) {
		const regex = new RegExp('^' + pattern.replace(/\*/g, '[^/]+') + '$')
		return regex.test(path)
	}

	return false
}

const shouldSkip = (
	path: string,
	skip?: string[] | ((path: string) => boolean)
): boolean => {
	if (!skip) return false
	if (typeof skip === 'function') return skip(path)
	return skip.some((pattern) => matchPattern(pattern, path))
}

/**
 * Logger middleware for Elysia
 *
 * Logs HTTP method, path, status code, and response time for each request
 *
 * @example
 * ```ts
 * import { Elysia } from 'elysia'
 * import { logger } from 'elysia/logger'
 *
 * new Elysia()
 *   .use(logger())
 *   .get('/', () => 'Hello World')
 *   .listen(3000)
 * ```
 *
 * @example With custom output
 * ```ts
 * import { Elysia } from 'elysia'
 * import { logger } from 'elysia/logger'
 *
 * new Elysia()
 *   .use(logger({
 *     output: (entry) => {
 *       // Send to external logging service
 *       externalLogger.log(entry)
 *     }
 *   }))
 *   .listen(3000)
 * ```
 *
 * @example Skip certain paths
 * ```ts
 * import { Elysia } from 'elysia'
 * import { logger } from 'elysia/logger'
 *
 * new Elysia()
 *   .use(logger({
 *     skip: ['/health', '/metrics']
 *   }))
 *   .listen(3000)
 * ```
 */
export const logger = (options: LoggerOptions = {}) => {
	const { output, skip, colored = true } = options
	const log = output ?? defaultLogger(colored)

	const startTimes = new WeakMap<Request, number>()

	return new Elysia({ name: 'elysia-logger' })
		.onRequest((context) => {
			startTimes.set(context.request, performance.now())
		})
		.onAfterResponse({ as: 'global' }, (context) => {
			const { request, path, set } = context
			const startTime = startTimes.get(request)

			startTimes.delete(request)

			if (startTime === undefined) return

			const method = request.method

			if (shouldSkip(path, skip)) return

			const duration = performance.now() - startTime
			const status = (set.status as number) ?? 200

			const entry: LogEntry = {
				method,
				path,
				status,
				duration,
				timestamp: new Date()
			}

			log(entry)
		})
}

export default logger
