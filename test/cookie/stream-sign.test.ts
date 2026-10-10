import { describe, expect, it } from 'bun:test'
import { Elysia, status } from '../../src'
import { unsignCookie } from '../../src/cookie/crypto'
import {
	aotReconstructHandle,
	jitHandle,
	lazyHandle,
	precompileHandle,
	type LaneFactory
} from '../differential/lanes'

// A streamed handler's body runs on the stream's first pull, after the route
// signed its cookies and before the response headers are built: a cookie it
// writes there must still leave signed, never unsigned

const config = { cookie: { secrets: 'secret', sign: ['session', 'token'] } }

const lanes = [lazyHandle, jitHandle, precompileHandle, aotReconstructHandle]

// what each signed cookie verifies to with the configured secret: `false` if
// sent unsigned, `undefined` if not sent
const verified = async (res: Response) => {
	const out: Record<string, unknown> = {}

	for (const cookie of (res.headers.get('set-cookie') ?? '').split(
		/, (?=[^ ;]+=)/
	)) {
		const pair = cookie.split(';')[0]!
		const at = pair.indexOf('=')
		const name = pair.slice(0, at)
		if (name !== 'session' && name !== 'token') continue

		out[name] = await unsignCookie(
			decodeURIComponent(pair.slice(at + 1)),
			'secret',
			name
		)
	}

	return out
}

const handlers = {
	generator: function* ({ cookie }: any) {
		cookie.session.value = 'user-42'
		yield 'a'
		yield 'b'
	},
	'async generator': async function* ({ cookie }: any) {
		cookie.session.value = 'user-42'
		await Promise.resolve()
		// still the first chunk's body
		cookie.token.value = 't-7'
		yield 'a'
		yield 'b'
	},
	stream: ({ cookie }: any) => {
		cookie.session.value = 'user-42'

		return new ReadableStream({
			start(controller) {
				cookie.token.value = 't-7'
				controller.enqueue('a')
				controller.enqueue('b')
				controller.close()
			}
		})
	}
}

// the afterResponse lane tees the stream: the control
const define =
	(handler: Function, afterResponse: boolean, error?: () => unknown) =>
	(app: any) => {
		let next = new Elysia({ ...app['~config'], ...config })
		if (error) next = next.onError(error as any)
		if (afterResponse) next = next.onAfterResponse(() => {})

		return next.get('/', handler as any)
	}

const serve = async (lane: LaneFactory, define: (app: any) => any) => {
	const instance = await lane.make(define)

	try {
		const res = await instance.handle(new Request('http://localhost/'))

		return {
			status: res.status,
			body: await res.text(),
			cookies: await verified(res)
		}
	} finally {
		await instance.dispose()
	}
}

describe('streamed responses sign their cookies', () => {
	for (const lane of lanes)
		it(`signs what the first chunk's body writes with ${lane.id}`, async () => {
			const served: Record<string, unknown> = {}
			const expected: Record<string, unknown> = {}

			for (const [kind, handler] of Object.entries(handlers))
				for (const afterResponse of [false, true]) {
					const name = `${kind}${afterResponse ? ', afterResponse' : ''}`

					served[name] = await serve(
						lane,
						define(handler, afterResponse)
					)
					expected[name] = {
						status: 200,
						body: 'ab',
						cookies:
							kind === 'generator'
								? { session: 'user-42' }
								: { session: 'user-42', token: 't-7' }
					}
				}

			expect(served).toEqual(expected)
		})

	// headers haven't gone out yet: a sign failure there ends on the 500,
	// never on the stream or a hook's answer, and the generator is closed
	for (const lane of lanes)
		it(`fails closed when the first chunk's cookie fails to sign with ${lane.id}`, async () => {
			const digest = (Bun as any).CryptoHasher.prototype.digest
			const served: Record<string, unknown> = {}
			const expected: Record<string, unknown> = {}

			for (const kind of ['generator', 'async generator'] as const)
				for (const hook of [false, true]) {
					let closed = false
					const handler =
						kind === 'generator'
							? function* ({ cookie }: any) {
									try {
										cookie.session.value = 'user-42'
										yield 'a'
									} finally {
										closed = true
									}
								}
							: async function* ({ cookie }: any) {
									try {
										await Promise.resolve()
										cookie.session.value = 'user-42'
										yield 'a'
									} finally {
										closed = true
									}
								}

					const instance = await lane.make(
						define(
							handler,
							false,
							hook ? () => status(200, 'handled') : undefined
						)
					)

					try {
						;(Bun as any).CryptoHasher.prototype.digest = () => {
							throw new Error('signer down')
						}

						const res = await instance.handle(
							new Request('http://localhost/')
						)
						const body = await res.text()
						const name = `${kind}${hook ? ', error hook' : ''}`

						served[name] = {
							status: res.status,
							streamed: body === 'a',
							answered: body === 'handled',
							session: (
								res.headers.get('set-cookie') ?? ''
							).includes('session='),
							closed
						}
						expected[name] = {
							status: 500,
							streamed: false,
							answered: false,
							session: false,
							closed: true
						}
					} finally {
						;(Bun as any).CryptoHasher.prototype.digest = digest
						await instance.dispose()
					}
				}

			expect(served).toEqual(expected)
		})

	// The body throws before its first chunk: the error lane signs what it
	// wrote, sent once and signed, not also unsigned from headers built early
	for (const lane of lanes)
		it(`signs once what the first chunk's body wrote before throwing with ${lane.id}`, async () => {
			for (const kind of ['generator', 'async generator'] as const) {
				const instance = await lane.make(
					define(
						kind === 'generator'
							? function* ({ cookie }: any) {
									cookie.session.value = 'user-42'
									throw new Error('boom')
									yield 'a'
								}
							: async function* ({ cookie }: any) {
									cookie.session.value = 'user-42'
									await Promise.resolve()
									throw new Error('boom')
									yield 'a'
								},
						false
					)
				)

				try {
					const res = await instance.handle(
						new Request('http://localhost/')
					)
					const sessions = (res.headers.get('set-cookie') ?? '')
						.split(/, (?=[^ ;]+=)/)
						.filter((cookie) => cookie.startsWith('session='))

					expect({
						kind,
						status: res.status,
						sessions: sessions.length,
						cookies: await verified(res)
					}).toEqual({
						kind,
						status: 500,
						sessions: 1,
						cookies: { session: 'user-42' }
					})
				} finally {
					await instance.dispose()
				}
			}
		})

	// After the first chunk the headers are out: a cookie written then is
	// dropped, never sent unsigned. The afterResponse lane's tee drains a
	// short stream ahead of the headers, so there it arrives signed
	for (const lane of lanes)
		it(`never sends a cookie written after the first chunk unsigned with ${lane.id}`, async () => {
			for (const afterResponse of [false, true]) {
				const { status, body, cookies } = await serve(
					lane,
					define(function* ({ cookie }: any) {
						yield 'a'
						cookie.session.value = 'late'
						yield 'b'
					}, afterResponse)
				)

				expect({ afterResponse, status, body }).toEqual({
					afterResponse,
					status: 200,
					body: 'ab'
				})
				if (afterResponse)
					expect([undefined, 'late']).toContain(
						cookies.session as any
					)
				else expect(cookies.session).toBeUndefined()
			}
		})
})
