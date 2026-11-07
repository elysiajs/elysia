// A fresh process sets NODE_ENV before the compiled error pipeline is created.
import { Elysia, status } from '../../src'

const get = () => new Request('http://localhost/')

const throwing = (mut: (e: any) => void) =>
	new Elysia()
		.onError(() => {})
		.get('/', () => {
			const e: any = new Error('secret: db password is hunter2')
			mut(e)
			throw e
		})

class ThrowingToResponse extends Error {
	status = 503
	constructor() {
		super('original 503 message')
		this.name = 'ThrowingToResponse'
	}
	toResponse(): Response {
		throw new Error('INNER-THROW-LEAK')
	}
}

const compiledThrow = () =>
	new Elysia()
		.onError(() => {})
		.get('/', () => {
			throw new ThrowingToResponse()
		})
		.handle(get())

const interpretedThrow = () =>
	new Elysia()
		.get('/', () => {
			throw new ThrowingToResponse()
		})
		.handle(get())

// An HTTP client's failure as an uncaught call surfaces it: axios (fetch
// adapter) parks the upstream body, headers and the outgoing request config
// on `.response`, a fetch wrapper parks the upstream `Response` itself
const clientError = (kind: string, code: number) => () =>
	Object.assign(new Error(`Request failed with status code ${code}`), {
		status: code,
		response:
			kind === 'object'
				? {
						data: { upstream: 'UPSTREAM-BODY' },
						headers: { 'set-cookie': 'upsess=UPSTREAM-COOKIE' },
						config: {
							headers: { authorization: 'Bearer UPSTREAM-TOKEN' }
						}
					}
				: new Response('UPSTREAM-BODY', {
						status: code,
						headers: {
							'set-cookie': 'upsess=UPSTREAM-COOKIE',
							'x-upstream': 'UPSTREAM-HEADER'
						}
					})
	})

const clientLanes: Record<string, (error: () => Error) => Elysia<any>> = {
	thrown: (error) =>
		new Elysia().get('/', () => {
			throw error()
		}),
	returned: (error) => new Elysia().get('/', () => error()),
	beforeHandle: (error) =>
		new Elysia().get(
			'/',
			{
				beforeHandle() {
					throw error()
				}
			},
			() => 'unreachable'
		),
	onError: (error) =>
		new Elysia()
			.onError(() => {})
			.get('/', () => {
				throw error()
			})
}

const clientScenarios: Record<string, () => Promise<Response>> = {}
for (const lane in clientLanes)
	for (const kind of ['object', 'response'])
		for (const code of [401, 500])
			clientScenarios[`client.${lane}.${kind}.${code}`] = () =>
				clientLanes[lane]!(clientError(kind, code)).handle(get())

const scenarios: Record<string, () => Promise<Response>> = {
	...clientScenarios,

	statusObject: () =>
		new Elysia()
			.get('/', () => {
				throw status(401, { a: 1 })
			})
			.handle(get()),

	fiveHundred: () => throwing((e) => (e.status = 500)).handle(get()),

	explicitResponse: () =>
		throwing((e) => {
			e.status = 500
			e.response = 'explicit body'
		}).handle(get()),

	// `.response` is the property name every common HTTP client puts its whole
	// upstream response on (`AxiosError.response`), so a rethrown client error
	// is not a declared body
	foreignClientResponse: () =>
		throwing((e) => {
			e.status = 502
			e.response = {
				config: { headers: { authorization: 'Bearer hunter2' } },
				data: 'postgres://user:hunter2@db/app'
			}
		}).handle(get()),

	fourHundred: () => throwing((e) => (e.status = 400)).handle(get()),

	fiveOhThree: () => throwing((e) => (e.status = 503)).handle(get()),

	syncThrowCompiled: compiledThrow,
	syncThrowInterpreted: interpretedThrow
}

const out: Record<
	string,
	{ status: number; body: string; headers: Record<string, string> }
> = {}
for (const key in scenarios) {
	const res = await scenarios[key]!()
	out[key] = {
		status: res.status,
		body: await res.text(),
		headers: Object.fromEntries(res.headers)
	}
}

console.log(JSON.stringify(out))
