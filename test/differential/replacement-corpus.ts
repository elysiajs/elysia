import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'

const response = async (app: any, path: string) => {
	const value = await app.handle(path)
	return { status: value.status, body: await value.text() }
}

const contractResponse = async (app: any, path: string) => {
	const value = await app.handle(path)
	return {
		status: value.status,
		body: await value.text(),
		defaultHeader: value.headers.get('x-default'),
		sinkHeader: value.headers.get('x-sink')
	}
}

const counter = () => ({ getter: 0, call: 0 })

const fulfilledThenable = (value: unknown, seen: ReturnType<typeof counter>) =>
	Object.defineProperty({}, 'then', {
		get() {
			seen.getter++
			return (resolve: (value: unknown) => void) => {
				seen.call++
				resolve(value)
			}
		}
	})

const rejectedThenable = (message: string, seen: ReturnType<typeof counter>) =>
	Object.defineProperty({}, 'then', {
		get() {
			seen.getter++
			return (
				_resolve: (value: unknown) => void,
				reject: (error: unknown) => void
			) => {
				seen.call++
				reject(new Error(message))
			}
		}
	})

const throwingThenGetter = (message: string, seen: ReturnType<typeof counter>) =>
	Object.defineProperty({}, 'then', {
		get() {
			seen.getter++
			throw new Error(message)
		}
	})

const crossRealmPromise = (value: string) =>
	runInNewContext('Promise.resolve(value)', { value })

export async function customThenableContract(productRoot: string) {
	const { Elysia } = await import(
		pathToFileURL(resolve(productRoot, 'src/index.ts')).href
	)

	const handlerCounts = {
		compact: counter(),
		set: counter(),
		defaultHeaders: counter(),
		setWithDefaultHeaders: counter()
	}
	const handlerApps = {
		compact: new Elysia().get('/handler', () =>
			fulfilledThenable('handler:compact', handlerCounts.compact)
		),
		set: new Elysia().get('/handler', ({ set }: any) => {
			set.status = 201
			set.headers['x-sink'] = 'set'
			return fulfilledThenable('handler:set', handlerCounts.set)
		}),
		defaultHeaders: new Elysia()
			.headers({ 'x-default': 'default' })
			.get('/handler', () =>
				fulfilledThenable(
					'handler:default-headers',
					handlerCounts.defaultHeaders
				)
			),
		setWithDefaultHeaders: new Elysia()
			.headers({ 'x-default': 'default' })
			.get('/handler', ({ set }: any) => {
				set.status = 202
				set.headers['x-sink'] = 'set-with-default-headers'
				return fulfilledThenable(
					'handler:set-with-default-headers',
					handlerCounts.setWithDefaultHeaders
				)
			})
	}

	const beforeCounts = {
		compact: counter(),
		set: counter(),
		defaultHeaders: counter(),
		setWithDefaultHeaders: counter()
	}
	const handlerRuns = {
		compact: 0,
		set: 0,
		defaultHeaders: 0,
		setWithDefaultHeaders: 0
	}
	const beforeApps = {
		compact: new Elysia().get(
			'/before',
			{
				beforeHandle: () =>
					fulfilledThenable('before:compact', beforeCounts.compact)
			},
			() => {
				handlerRuns.compact++
				return 'handler'
			}
		),
		set: new Elysia().get(
			'/before',
			{
				beforeHandle: ({ set }: any) => {
					set.status = 201
					set.headers['x-sink'] = 'set'
					return fulfilledThenable('before:set', beforeCounts.set)
				}
			},
			() => {
				handlerRuns.set++
				return 'handler'
			}
		),
		defaultHeaders: new Elysia()
			.headers({ 'x-default': 'default' })
			.get(
				'/before',
				{
					beforeHandle: () =>
						fulfilledThenable(
							'before:default-headers',
							beforeCounts.defaultHeaders
						)
				},
				() => {
					handlerRuns.defaultHeaders++
					return 'handler'
				}
			),
		setWithDefaultHeaders: new Elysia()
			.headers({ 'x-default': 'default' })
			.get(
				'/before',
				{
					beforeHandle: ({ set }: any) => {
						set.status = 202
						set.headers['x-sink'] = 'set-with-default-headers'
						return fulfilledThenable(
							'before:set-with-default-headers',
							beforeCounts.setWithDefaultHeaders
						)
					}
				},
				() => {
					handlerRuns.setWithDefaultHeaders++
					return 'handler'
				}
			)
	}

	const failureCounts = {
		handlerRejection: counter(),
		beforeRejection: counter(),
		handlerThrowingGetter: counter(),
		beforeThrowingGetter: counter()
	}
	const errorApp = (handler: () => unknown, beforeHandle?: () => unknown) => {
		const app = new Elysia().error(
			({ error }: any) => `caught:${error.message}`
		)
		return beforeHandle
			? app.get('/failure', { beforeHandle }, handler)
			: app.get('/failure', handler)
	}
	const failures = {
		handlerRejection: errorApp(() =>
			rejectedThenable('handler-rejection', failureCounts.handlerRejection)
		),
		beforeRejection: errorApp(
			() => 'handler',
			() =>
				rejectedThenable('before-rejection', failureCounts.beforeRejection)
		),
		handlerThrowingGetter: errorApp(() =>
			throwingThenGetter(
				'handler-throwing-getter',
				failureCounts.handlerThrowingGetter
			)
		),
		beforeThrowingGetter: errorApp(
			() => 'handler',
			() =>
				throwingThenGetter(
					'before-throwing-getter',
					failureCounts.beforeThrowingGetter
				)
		)
	}

	let crossRealmBeforeHandlerRuns = 0
	const crossRealm = {
		handler: new Elysia().get('/cross-realm', () =>
			crossRealmPromise('cross-realm:handler')
		),
		beforeHandle: new Elysia().get(
			'/cross-realm',
			{
				beforeHandle: () => crossRealmPromise('cross-realm:before')
			},
			() => {
				crossRealmBeforeHandlerRuns++
				return 'handler'
			}
		)
	}

	return {
		handlerFulfillment: {
			compact: await contractResponse(handlerApps.compact, '/handler'),
			set: await contractResponse(handlerApps.set, '/handler'),
			defaultHeaders: await contractResponse(
				handlerApps.defaultHeaders,
				'/handler'
			),
			setWithDefaultHeaders: await contractResponse(
				handlerApps.setWithDefaultHeaders,
				'/handler'
			)
		},
		beforeHandleFulfillment: {
			compact: await contractResponse(beforeApps.compact, '/before'),
			set: await contractResponse(beforeApps.set, '/before'),
			defaultHeaders: await contractResponse(
				beforeApps.defaultHeaders,
				'/before'
			),
			setWithDefaultHeaders: await contractResponse(
				beforeApps.setWithDefaultHeaders,
				'/before'
			)
		},
		counts: { handler: handlerCounts, beforeHandle: beforeCounts, handlerRuns },
		failures: {
			handlerRejection: await contractResponse(
				failures.handlerRejection,
				'/failure'
			),
			beforeRejection: await contractResponse(
				failures.beforeRejection,
				'/failure'
			),
			handlerThrowingGetter: await contractResponse(
				failures.handlerThrowingGetter,
				'/failure'
			),
			beforeThrowingGetter: await contractResponse(
				failures.beforeThrowingGetter,
				'/failure'
			),
			counts: failureCounts
		},
		crossRealmNativePromise: {
			handler: await contractResponse(crossRealm.handler, '/cross-realm'),
			beforeHandle: await contractResponse(
				crossRealm.beforeHandle,
				'/cross-realm'
			),
			beforeHandleHandlerRuns: crossRealmBeforeHandlerRuns
		}
	}
}

export async function asyncPluginContract(productRoot: string) {
	const { Elysia } = await import(
		pathToFileURL(resolve(productRoot, 'src/index.ts')).href
	)

	let resolveOuter!: (value: any) => void
	let resolveInner!: (value: any) => void
	const outer = new Promise((resolve) => (resolveOuter = resolve))
	const inner = new Promise((resolve) => (resolveInner = resolve))
	const app = new Elysia()
		.get('/sync', () => 'sync')
		.use(outer as any)

	const before = {
		sync: await response(app, '/sync'),
		outer: await response(app, '/outer')
	}
	resolveOuter(
		new Elysia().get('/outer', () => 'outer').use(inner as any)
	)
	await Bun.sleep(0)
	const nestedPending = await response(app, '/outer')
	resolveInner(new Elysia().get('/inner', () => 'inner'))
	await app.modules
	const after = {
		sync: await response(app, '/sync'),
		outer: await response(app, '/outer'),
		inner: await response(app, '/inner')
	}

	const factory = new Elysia().use(async () =>
		new Elysia().get('/factory', () => 'factory')
	)
	await factory.modules

	const originalError = console.error
	console.error = () => {}
	let failure: string | undefined
	let failedApp: any
	try {
		failedApp = new Elysia()
			.get('/sync', () => 'sync')
			.use(Promise.reject(new Error('post-n4-plugin-failure')))
		try {
			await failedApp.modules
		} catch (error) {
			failure = (error as Error).message
		}
	} finally {
		console.error = originalError
	}

	return {
		before,
		nestedPending,
		after,
		factory: await response(factory, '/factory'),
		failure: {
			reason: failure,
			sync: await response(failedApp, '/sync')
		}
	}
}
