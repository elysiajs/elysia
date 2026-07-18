// Each case gets a fresh app and requests. `safe-for-socket` enables socket
// lanes, `handle-only` excludes them, and `observe` records hook order.

import { Elysia, t, status, redirect, type AnyElysia } from '../../src'

export interface CorpusRequest {
	id: string
	make: () => Request
	tags?: string[]
	// Intentional contract flips use direct old/new golden tests instead of
	// asking the byte-parity oracle to call the changed result equivalent.
	excludePairs?: string[]
}

export interface CorpusEntry {
	id: string
	tags: string[]
	define: (app: AnyElysia) => AnyElysia
	requests: CorpusRequest[]
}

const url = (path: string) => `http://localhost${path}`
const get = (path: string) => () => new Request(url(path))
const json = (path: string, body: unknown) => () =>
	new Request(url(path), {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	})
const standard = (vendor: string, validate: (value: any) => unknown): any => ({
	'~standard': { version: 1, vendor, validate }
})

export interface Recorder {
	events: string[]
	reset(): void
}

export const makeRecorder = (): Recorder => ({
	events: [],
	reset() {
		this.events = []
	}
})

export interface ObservableCorpusEntry extends CorpusEntry {
	recorder?: Recorder
}

const makeThenable = (value: unknown) => ({
	then(resolve: (v: unknown) => void) {
		resolve(value)
	}
})

const makeThrowingThenGetter = () => {
	const obj = {} as Record<string, unknown>
	Object.defineProperty(obj, 'then', {
		configurable: true,
		enumerable: true,
		get() {
			throw new Error('then-getter-boom')
		}
	})
	return obj
}

export const corpus: ObservableCorpusEntry[] = []

corpus.push({
	id: 'native-static-literal',
	tags: ['safe-for-socket', 'static', 'native-static'],
	define: (app) => app.get('/native/literal', 'literal'),
	requests: [{ id: 'literal', make: get('/native/literal') }]
})

{
	const recorder = makeRecorder()
	corpus.push({
		id: 'native-static-after-response',
		tags: ['safe-for-socket', 'static', 'observe', 'native-static'],
		recorder,
		define: (app) =>
			app.get(
				'/native/after-response',
				{
					afterResponse() {
						recorder.events.push('afterResponse')
					}
				},
				'literal'
			),
		requests: [
			{ id: 'after-response', make: get('/native/after-response') }
		]
	})
}

corpus.push({
	id: 'inference-template-regex-division',
	tags: ['inference'],
	define: (app) =>
		app.post('/inference/lexical', (c: any) => {
			const ignored = /c\.cookie/u
			const text = 'c.set'
			return `${text}:${ignored}:${10 / c.body.count}:${c.query.value}`
		}),
	requests: [
		{
			id: 'lexical',
			make: () =>
				new Request(url('/inference/lexical?value=ok'), {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: '{"count":2}'
				})
		}
	]
})

corpus.push({
	id: 'inference-unicode-computed-forwarded',
	tags: ['inference'],
	define: (app) => {
		const key = 'query'
		const read = (context: any) => context.query.value
		const nestedArrow = function (context: any) {
			const project = (value: any) => value.name
			void project
			return context.headers['x-nested']
		}
		// Keep the reference lane independently inferable so this request fails
		// specifically when the candidate omits a computed-destructured channel.
		const computedDestructuring =
			app['~config']?.experimental?.inference === 'candidate'
				? ({ ['query']: q }: any) => q.value
				: (context: any) => context.query.value
		return app
			.get(
				'/inference/unicode',
				(context: any) =>
					`${context.装饰 ?? 'unicode'}:${context.headers['x-unicode']}`
			)
			.get('/inference/computed', (context: any) => context[key].value)
			.get(
				'/inference/computed-destructuring',
				computedDestructuring
			)
			.get('/inference/forwarded', (context: any) => read(context))
			.get('/inference/nested-arrow', nestedArrow)
			.get('/inference/zero-parameter', () => 'compact')
	},
	requests: [
		{
			id: 'unicode',
			make: () =>
				new Request(url('/inference/unicode'), {
					headers: { 'x-unicode': 'yes' }
				})
		},
		{ id: 'computed', make: get('/inference/computed?value=ok') },
		{
			id: 'computed-destructuring',
			make: get('/inference/computed-destructuring?value=ok')
		},
		{ id: 'forwarded', make: get('/inference/forwarded?value=ok') },
		{
			id: 'nested-arrow',
			make: () =>
				new Request(url('/inference/nested-arrow'), {
					headers: { 'x-nested': 'ok' }
				})
		},
		{ id: 'zero-parameter', make: get('/inference/zero-parameter') }
	]
})

corpus.push({
	id: 'inference-forged-native-bound',
	tags: ['inference'],
	define: (app) => {
		const forged = (context: any) => context.query.value
		Object.defineProperty(forged, 'toString', {
			value: () => '(context) => context.query.value'
		})
		const bound = ((context: any) => context.query.value).bind(null)
		return app
			.get('/inference/forged', forged)
			.get('/inference/bound', bound)
			.get('/inference/native', String as any)
	},
	requests: [
		{ id: 'forged', make: get('/inference/forged?value=ok') },
		{ id: 'bound', make: get('/inference/bound?value=ok') },
		{ id: 'native', make: get('/inference/native') }
	]
})

corpus.push({
	id: 'inference-lifecycle-overrides',
	tags: ['inference'],
	define: (app) =>
		app.group('', (group) =>
			group
				.guard({
					inference: { query: false, headers: true, body: true },
					beforeHandle() {}
				})
				.get(
					'/inference/overrides',
					{
						inference: { query: true, headers: false },
						beforeHandle(context: any) {
							context.set.headers['x-inference'] = 'lifecycle'
						}
					},
					(context: any) => context.query.value
				)
				.get(
					'/inference/validator-force',
					{
						query: t.Object({ value: t.String() }),
						inference: { query: false }
					},
					({ query }: any) => query.value
				)
		),
	requests: [
		{ id: 'overrides', make: get('/inference/overrides?value=ok') },
		{
			id: 'validator-force',
			make: get('/inference/validator-force?value=ok')
		}
	]
})

corpus.push({
	id: 'validation-nested-defaults',
	tags: ['safe-for-socket', 'body', 'schema'],
	define: (app) =>
		app.post(
			'/validation/nested-defaults',
			{
				body: t.Object({
					profile: t.Object(
						{
							settings: t.Object(
								{
									theme: t.String({ default: 'dark' }),
									pageSize: t.Number({ default: 20 })
								},
								{ default: {} }
							)
						},
						{ default: {} }
					)
				})
			},
			({ body }) => body
		),
	requests: [
		{ id: 'missing-all', make: json('/validation/nested-defaults', {}) },
		{
			id: 'missing-leaves',
			make: json('/validation/nested-defaults', {
				profile: { settings: {} }
			})
		},
		{
			id: 'explicit-values',
			make: json('/validation/nested-defaults', {
				profile: { settings: { theme: 'light', pageSize: 50 } }
			})
		}
	]
})

corpus.push({
	id: 'validation-object-array-string',
	tags: ['safe-for-socket', 'query', 'schema'],
	define: (app) =>
		app.get(
			'/validation/string-codecs',
			{
				query: t.Object({
					filter: t.ObjectString({
						min: t.Number(),
						label: t.String()
					}),
					ids: t.ArrayString(t.Number())
				})
			},
			({ query }) => query
		),
	requests: [
		{
			id: 'decode-both',
			make: get(
				'/validation/string-codecs?filter=' +
					encodeURIComponent('{"min":1,"label":"a"}') +
					'&ids=' +
					encodeURIComponent('[1,2,3]')
			)
		},
		{
			id: 'invalid-object-string',
			make: get(
				'/validation/string-codecs?filter=' +
					encodeURIComponent('{"min":"x","label":"a"}') +
					'&ids=' +
					encodeURIComponent('[1,2,3]')
			)
		},
		{
			id: 'invalid-array-string',
			make: get(
				'/validation/string-codecs?filter=' +
					encodeURIComponent('{"min":1,"label":"a"}') +
					'&ids=' +
					encodeURIComponent('[1,"x"]')
			)
		}
	]
})

corpus.push({
	id: 'validation-object-union',
	tags: ['safe-for-socket', 'body', 'schema'],
	define: (app) =>
		app.post(
			'/validation/object-union',
			{
				body: t.Union([
					t.Object({
						kind: t.Literal('count'),
						value: t.Number()
					}),
					t.Object({
						kind: t.Literal('label'),
						value: t.String()
					})
				])
			},
			({ body }) => body
		),
	requests: [
		{
			id: 'number-branch',
			make: json('/validation/object-union', {
				kind: 'count',
				value: 1
			})
		},
		{
			id: 'string-branch',
			make: json('/validation/object-union', {
				kind: 'label',
				value: 'one'
			})
		},
		{
			id: 'invalid-branch',
			make: json('/validation/object-union', {
				kind: 'count',
				value: 'one'
			})
		}
	]
})

corpus.push({
	id: 'validation-ref-cyclic',
	tags: ['safe-for-socket', 'body', 'schema'],
	define: (app) => {
		const Job = t.Object({ title: t.String() }, { $id: 'D2Job' })
		const Person = t.Object(
			{ name: t.String(), job: t.Ref('D2Job') },
			{ $id: 'D2Person' }
		)
		const Node = t.Cyclic(
			{
				node: t.Object({
					value: t.String(),
					next: t.Nullable(t.Ref('node'))
				})
			},
			'node'
		)

		return app
			.model({ D2Job: Job, D2Person: Person })
			.post(
				'/validation/ref',
				{ body: t.Ref('D2Person') },
				({ body }) => body
			)
			.post('/validation/cyclic', { body: Node }, ({ body }) => body)
	},
	requests: [
		{
			id: 'ref-valid',
			make: json('/validation/ref', {
				name: 'Ada',
				job: { title: 'compiler' }
			})
		},
		{
			id: 'ref-invalid',
			make: json('/validation/ref', {
				name: 'Ada',
				job: { title: 1 }
			})
		},
		{
			id: 'cyclic-valid',
			make: json('/validation/cyclic', {
				value: 'root',
				next: { value: 'leaf', next: null }
			})
		},
		{
			id: 'cyclic-invalid',
			make: json('/validation/cyclic', {
				value: 'root',
				next: { value: 1, next: null }
			})
		}
	]
})

{
	const recorder = makeRecorder()
	corpus.push({
		id: 'validation-refine-codec-calls',
		tags: ['safe-for-socket', 'body', 'schema', 'observe'],
		recorder,
		define: (app) => {
			const Name = t.Refine(t.String(), (value: string) => {
				recorder.events.push(`refine:${value}`)
				return value !== 'bad'
			})
			const Count = t
				.Codec(t.String())
				.Decode((value: string) => {
					recorder.events.push(`decode:${value}`)
					return Number(value)
				})
				.Encode((value: number) => {
					recorder.events.push(`encode:${value}`)
					return String(value)
				})

			return app.post(
				'/validation/refine-codec',
				{
					body: t.Object({ name: Name, count: Count }),
					response: t.Object({ name: t.String(), count: Count })
				},
				({ body }) => body
			)
		},
		requests: [
			{
				id: 'success-counts',
				make: json('/validation/refine-codec', {
					name: 'ok',
					count: '2'
				})
			},
			{
				id: 'refine-failure-counts',
				make: json('/validation/refine-codec', {
					name: 'bad',
					count: '2'
				})
			}
		]
	})
}

{
	const recorder = makeRecorder()
	corpus.push({
		id: 'validation-standard-schema',
		tags: ['safe-for-socket', 'body', 'schema', 'async', 'observe'],
		recorder,
		define: (app) => {
			const validate = (kind: string, value: any) => {
				recorder.events.push(kind)
				return typeof value?.id === 'number'
					? { value: { id: value.id, kind } }
					: { issues: [{ message: 'id must be a number' }] }
			}
			const sync = standard('d2-sync', (value) => validate('sync', value))
			const async = standard('d2-async', async (value) =>
				validate('async', value)
			)
			const thenable = standard('d2-thenable', (value) =>
				makeThenable(validate('thenable', value))
			)

			return app
				.post(
					'/validation/standard-sync',
					{ body: sync },
					({ body }) => body
				)
				.post(
					'/validation/standard-async',
					{ body: async },
					({ body }) => body
				)
				.post(
					'/validation/standard-thenable',
					{ body: thenable },
					({ body }) => body
				)
		},
		requests: [
			{
				id: 'sync-success',
				make: json('/validation/standard-sync', { id: 1 })
			},
			{
				id: 'sync-failure',
				make: json('/validation/standard-sync', { id: 'x' })
			},
			{
				id: 'async-success',
				make: json('/validation/standard-async', { id: 1 })
			},
			{
				id: 'async-failure',
				make: json('/validation/standard-async', { id: 'x' })
			},
			{
				id: 'thenable-success',
				make: json('/validation/standard-thenable', { id: 1 })
			},
			{
				id: 'thenable-failure',
				make: json('/validation/standard-thenable', { id: 'x' })
			}
		]
	})
}

{
	const recorder = makeRecorder()
	corpus.push({
		id: 'validation-response-encode-status',
		tags: ['safe-for-socket', 'response', 'schema', 'observe'],
		recorder,
		define: (app) => {
			const coded = (label: string) =>
				t
					.Codec(t.String())
					.Decode((value: string) => Number(value))
					.Encode((value: number) => {
						recorder.events.push(`${label}:${value}`)
						return `${label}:${value}`
					})

			return app
				.get(
					'/validation/response-200',
					{ response: { 200: t.Object({ value: coded('ok') }) } },
					() => ({ value: 1 })
				)
				.get(
					'/validation/response-201',
					{
						response: { 201: t.Object({ value: coded('created') }) }
					},
					() => status(201, { value: 2 })
				)
		},
		requests: [
			{ id: 'default-status', make: get('/validation/response-200') },
			{ id: 'created-status', make: get('/validation/response-201') }
		]
	})
}

{
	const recorder = makeRecorder()
	corpus.push({
		id: 'validation-q10-standalone-route',
		tags: ['safe-for-socket', 'body', 'schema', 'observe', 'q10'],
		recorder,
		define: (app) => {
			const standalone = standard('d2-q10', (value) => {
				recorder.events.push('standalone')
				return typeof value?.guarded === 'string'
					? {
							value: {
								route: value.route,
								guarded: value.guarded.toUpperCase()
							}
						}
					: { issues: [{ message: 'guarded must be a string' }] }
			})

			return app
				.guard({ schema: 'standalone', body: standalone })
				.post(
					'/validation/q10',
					{ body: t.Object({ route: t.Number() }) },
					({ body }) => body
				)
		},
		requests: [
			{
				id: 'both-pass',
				make: json('/validation/q10', { guarded: 'yes', route: 1 })
			},
			{
				id: 'standalone-fails',
				make: json('/validation/q10', { guarded: 1, route: 1 })
			}
		]
	})
}

corpus.push({
	id: 'validation-q10-first-member-failure',
	tags: ['safe-for-socket', 'body', 'schema', 'q10'],
	define: (app) =>
		app
			.guard({
				schema: 'standalone',
				body: standard('d2-q10-unreached', (value) => ({ value }))
			})
			.post(
				'/validation/q10-first-failure',
				{ body: t.Object({ route: t.Number() }) },
				({ body }) => body
			),
	requests: [
		{
			id: 'route-fails-before-standalone',
			excludePairs: ['jit-vs-validation-plan@handle'],
			make: json('/validation/q10-first-failure', {
				guarded: 'yes',
				route: 'x'
			})
		}
	]
})

{
	const recorder = makeRecorder()
	corpus.push({
		id: 'validation-q10-typebox-order',
		tags: [
			'safe-for-socket',
			'body',
			'response',
			'schema',
			'observe',
			'q10'
		],
		recorder,
		define: (app) => {
			const coded = (label: string) =>
				t
					.Codec(t.String())
					.Decode((value: string) => {
						recorder.events.push(`decode:${label}:${value}`)
						return Number(value)
					})
					.Encode((value: number) => {
						recorder.events.push(`encode:${label}:${value}`)
						return String(value)
					})

			return app
				.guard({
					schema: 'standalone',
					body: t.Object(
						{ guarded: coded('guarded') },
						{ additionalProperties: false }
					),
					response: {
						201: t.Object({ guarded: coded('response-guarded') })
					}
				})
				.post(
					'/validation/q10-typebox',
					{
						body: t.Object(
							{
								route: coded('route'),
								fallback: t.Number({ default: 9 })
							},
							{ additionalProperties: false }
						),
						response: {
							201: t.Object({ route: coded('response-route') })
						}
					},
					({ body }) =>
						status(201, {
							route: body.route,
							guarded: body.guarded
						})
				)
		},
		requests: [
			{
				id: 'ordered-codecs-and-default',
				make: json('/validation/q10-typebox', {
					route: '1',
					guarded: '2'
				})
			},
			{
				id: 'later-member-failure',
				make: json('/validation/q10-typebox', {
					route: '1',
					guarded: 'not-a-number'
				})
			}
		]
	})
}

corpus.push({
	id: 'validation-q10-closed-extra',
	tags: ['safe-for-socket', 'body', 'schema', 'q10'],
	define: (app) =>
		app
			.guard({
				schema: 'standalone',
				body: t.Object(
					{ guarded: t.String() },
					{ additionalProperties: false }
				)
			})
			.post(
				'/validation/q10-closed-extra',
				{
					body: t.Object(
						{ route: t.Number() },
						{ additionalProperties: false }
					)
				},
				({ body }) => body
			),
	requests: [
		{
			id: 'known-sibling-keys',
			make: json('/validation/q10-closed-extra', {
				route: 1,
				guarded: 'yes'
			})
		},
		{
			id: 'true-extra',
			excludePairs: ['jit-vs-validation-plan@handle'],
			make: json('/validation/q10-closed-extra', {
				route: 1,
				guarded: 'yes',
				extra: true
			})
		}
	]
})

{
	const recorder = makeRecorder()
	corpus.push({
		id: 'validation-form-codecs',
		tags: ['safe-for-socket', 'body', 'schema', 'form', 'observe'],
		recorder,
		define: (app) => {
			const snapshot = (label: string, body: any) => {
				const prototype = Object.getPrototypeOf(body)
				const descriptors = Reflect.ownKeys(body)
					.map((key) => {
						const descriptor = Object.getOwnPropertyDescriptor(
							body,
							key
						)!
						return `${String(key)}:${+!!descriptor.enumerable}${+!!descriptor.configurable}${+!!descriptor.writable}`
					})
					.sort()
					.join(',')
				recorder.events.push(
					`${label}:marker=${Object.hasOwn(body, '~ely-form')}:proto=${prototype === null ? 'null' : prototype === Object.prototype ? 'object' : 'other'}:symbols=${Object.getOwnPropertySymbols(body).length}:descriptors=${descriptors}`
				)
			}

			return app
				.post(
					'/validation/form-codecs',
					{
						body: t.Form({
							metadata: t.ObjectString({ name: t.String() }),
							ids: t.ArrayString(t.Number())
						}),
						error({ body }) {
							snapshot('sync-error', body)
						}
					},
					({ body }) => {
						snapshot('handler', body)
						return body
					}
				)
				.post(
					'/validation/form-codecs-async',
					{
						body: t.Form({
							metadata: t.ObjectString({ name: t.String() }),
							ids: t.ArrayString(t.Number()),
							file: t.File({ type: 'image/jpeg' })
						}),
						error({ body }) {
							snapshot('async-error', body)
						}
					},
					({ body }) => body
				)
		},
		requests: [
			{
				id: 'valid',
				make: () => {
					const body = new FormData()
					body.append('metadata', '{"name":"d2"}')
					body.append('ids', '[1,2]')
					return new Request(url('/validation/form-codecs'), {
						method: 'POST',
						body
					})
				}
			},
			{
				id: 'invalid-sync-preserves-input',
				make: () => {
					const body = new FormData()
					body.append('metadata', '{"name":1}')
					body.append('ids', '[1,2]')
					return new Request(url('/validation/form-codecs'), {
						method: 'POST',
						body
					})
				}
			},
			{
				id: 'invalid-async-preserves-input',
				make: () => {
					const body = new FormData()
					body.append('metadata', '{"name":"d2"}')
					body.append('ids', '[1,2]')
					body.append(
						'file',
						new Blob(['not-jpeg'], { type: 'image/png' }),
						'not-jpeg.png'
					)
					return new Request(url('/validation/form-codecs-async'), {
						method: 'POST',
						body
					})
				}
			}
		]
	})
}

corpus.push({
	id: 'validation-prototype-key',
	tags: ['safe-for-socket', 'body', 'schema'],
	define: (app) => {
		const properties = Object.defineProperty(
			{ value: t.Number() },
			'__proto__',
			{
				value: t.Object({ polluted: t.String() }),
				enumerable: true
			}
		)

		return app.post(
			'/validation/prototype-key',
			{ body: t.Object(properties as any) },
			({ body }) => ({
				value: body.value,
				own: Object.hasOwn(body as object, '__proto__'),
				plainPrototype:
					Object.getPrototypeOf(body) === Object.prototype,
				polluted: (body as any).polluted ?? null
			})
		)
	},
	requests: [
		{
			id: 'own-proto-data-property',
			make: () =>
				new Request(url('/validation/prototype-key'), {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: '{"value":1,"__proto__":{"polluted":"no"}}'
				})
		}
	]
})

{
	const recorder = makeRecorder()
	corpus.push({
		id: 'validation-commit-on-failure',
		tags: ['safe-for-socket', 'body', 'schema', 'observe'],
		recorder,
		define: (app) =>
			app.post(
				'/validation/commit-on-failure',
				{
					body: t.Object({
						coerced: t.Numeric(),
						tail: t.Literal('ok')
					}),
					transform({ body }) {
						recorder.events.push(
							`before:${typeof (body as any).coerced}`
						)
					},
					error({ body }) {
						recorder.events.push(
							`error:${typeof (body as any).coerced}`
						)
					}
				},
				({ body }) => {
					recorder.events.push('handler')
					return body
				}
			),
		requests: [
			{
				id: 'later-field-fails',
				make: json('/validation/commit-on-failure', {
					coerced: '1',
					tail: 'bad'
				})
			}
		]
	})
}

corpus.push({
	id: 'native-static-all',
	tags: ['safe-for-socket', 'static', 'method', 'native-static'],
	define: (app) => app.all('/native/all', 'all-literal'),
	requests: [
		{ id: 'get', make: get('/native/all') },
		{
			id: 'report',
			make: () => new Request(url('/native/all'), { method: 'REPORT' })
		}
	]
})

corpus.push({
	id: 'native-static-request-hook',
	tags: ['safe-for-socket', 'static', 'lifecycle', 'native-static'],
	define: (app) =>
		app.get(
			'/native/request-hook',
			{
				mapResponse({ request }) {
					return new Response(
						request.headers.get('x-value') ?? 'missing'
					)
				}
			},
			'literal'
		),
	requests: [
		{
			id: 'one',
			make: () =>
				new Request(url('/native/request-hook'), {
					headers: { 'x-value': 'one' }
				})
		},
		{
			id: 'two',
			make: () =>
				new Request(url('/native/request-hook'), {
					headers: { 'x-value': 'two' }
				})
		}
	]
})

corpus.push({
	id: 'static',
	tags: ['safe-for-socket', 'static'],
	define: (app) =>
		app
			.get('/', () => 'root')
			.get('/health', () => 'ok')
			.get('/api/v1/status', () => 'nested-static'),
	requests: [
		{ id: 'root', make: get('/') },
		{ id: 'health', make: get('/health') },
		{ id: 'nested', make: get('/api/v1/status') }
	]
})

corpus.push({
	id: 'default-headers',
	tags: ['safe-for-socket', 'headers', 'default-headers'],
	define: (app) =>
		app
			.headers({ 'x-app-default': 'base', 'x-shared': 'default' })
			.get('/headers/default', () => 'untouched')
			.get('/headers/patched', ({ set }) => {
				set.headers['x-shared'] = 'route'
				return 'patched'
			}),
	requests: [
		{ id: 'untouched', make: get('/headers/default') },
		{ id: 'request-local-patch', make: get('/headers/patched') }
	]
})

corpus.push({
	id: 'params',
	tags: ['safe-for-socket', 'param'],
	define: (app) =>
		app
			.get('/user/:id', ({ params }: any) => `id:${params.id}`)
			.get('/user/:id/post/:postId', ({ params }: any) => ({
				user: params.id,
				post: params.postId
			})),
	requests: [
		{ id: 'single', make: get('/user/42') },
		{ id: 'multi', make: get('/user/7/post/99') }
	]
})

corpus.push({
	id: 'routing-contract-edges',
	tags: ['safe-for-socket', 'param', 'wildcard', 'unicode', 'precedence'],
	define: (app) =>
		app
			.get('/time:zone', ({ params }: any) => `zone:${params.zone}`)
			.get('/asset*', ({ params }: any) => `asset:${params['*']}`)
			.get('/empty/:id/tail', ({ params }: any) => params.id)
			.get('/alias-a/café', () => 'raw-first')
			.get('/alias-a/caf%C3%A9', () => 'encoded-last')
			.get('/alias-b/caf%C3%A9', () => 'encoded-first')
			.get('/alias-b/café', () => 'raw-last'),
	requests: [
		{ id: 'embedded-param', make: get('/timeUTC') },
		{ id: 'prefix-wildcard-deep', make: get('/assetfoo/bar') },
		{ id: 'prefix-wildcard-empty', make: get('/asset') },
		{ id: 'empty-param-rejected', make: get('/empty//tail') },
		{ id: 'encoded-last-via-raw', make: get('/alias-a/café') },
		{ id: 'encoded-last-via-encoded', make: get('/alias-a/caf%C3%A9') },
		{ id: 'raw-last-via-raw', make: get('/alias-b/café') },
		{ id: 'raw-last-via-encoded', make: get('/alias-b/caf%C3%A9') }
	]
})

corpus.push({
	id: 'dynamic-route-context',
	tags: ['safe-for-socket', 'param', 'route'],
	define: (app) =>
		app.get('/route/:id', ({ route, params }: any) => ({
			route,
			id: params.id
		})),
	requests: [{ id: 'pattern', make: get('/route/42') }]
})

corpus.push({
	id: 'param-encoding',
	tags: ['safe-for-socket', 'param', 'unicode'],
	define: (app) => app.get('/echo/:v', ({ params }: any) => params.v),
	requests: [
		{
			id: 'thai',
			make: get(
				'/echo/%E0%B8%AA%E0%B8%A7%E0%B8%B1%E0%B8%AA%E0%B8%94%E0%B8%B5'
			)
		},
		{ id: 'emoji', make: get('/echo/%F0%9F%9A%80') },
		{ id: 'reserved', make: get('/echo/a%2Fb%20c') }
	]
})

corpus.push({
	id: 'wildcard',
	tags: ['safe-for-socket', 'wildcard'],
	define: (app) => app.get('/files/*', ({ params }: any) => params['*']),
	requests: [
		{ id: 'single-seg', make: get('/files/readme.txt') },
		{ id: 'deep', make: get('/files/a/b/c.png') },
		{ id: 'empty', make: get('/files/') }
	]
})

corpus.push({
	id: 'optional-nontail',
	tags: ['safe-for-socket', 'param', 'optional'],
	define: (app) =>
		app.get('/a/:b?/c', ({ params }: any) => `b=${params.b ?? 'none'}`),
	requests: [
		{ id: 'present', make: get('/a/x/c') },
		{ id: 'absent', make: get('/a/c') }
	]
})

corpus.push({
	id: 'trailing-slash',
	tags: ['safe-for-socket', 'path'],
	define: (app) => app.get('/loose', () => 'loose'),
	requests: [
		{ id: 'no-slash', make: get('/loose') },
		{ id: 'trailing-slash', make: get('/loose/') }
	]
})

corpus.push({
	id: 'precedence',
	tags: ['safe-for-socket', 'param', 'precedence'],
	define: (app) =>
		app
			.get('/u/me', () => 'me-literal')
			.get('/u/:id', ({ params }: any) => `id:${params.id}`),
	requests: [
		{ id: 'literal-wins', make: get('/u/me') },
		{ id: 'param-fallback', make: get('/u/42') }
	]
})

corpus.push({
	id: 'duplicate-route-static',
	tags: ['safe-for-socket', 'precedence'],
	define: (app) => app.get('/dup', () => 'first').get('/dup', () => 'second'),
	requests: [{ id: 'static-last-wins', make: get('/dup') }]
})

corpus.push({
	id: 'duplicate-route-dynamic',
	tags: ['safe-for-socket', 'precedence'],
	define: (app) =>
		app.get('/dup/:id', () => 'first').get('/dup/:id', () => 'second'),
	requests: [{ id: 'dynamic-last-wins', make: get('/dup/1') }]
})

corpus.push({
	id: 'all-method',
	tags: ['safe-for-socket', 'method'],
	define: (app) =>
		app.all('/any', ({ request }: any) => `m=${request.method}`),
	requests: [
		{ id: 'get', make: () => new Request(url('/any')) },
		{
			id: 'delete',
			make: () => new Request(url('/any'), { method: 'DELETE' })
		},
		{
			id: 'custom-report',
			make: () => new Request(url('/any'), { method: 'REPORT' })
		}
	]
})

corpus.push({
	id: 'query-scalar',
	tags: ['safe-for-socket', 'query', 'schema'],
	define: (app) =>
		app.get(
			'/q',
			{ query: t.Object({ n: t.Number(), b: t.Boolean() }) },
			({ query }) => query
		),
	requests: [
		{ id: 'valid', make: get('/q?n=5&b=true') },
		{ id: 'coerce-false', make: get('/q?n=0&b=false') },
		{ id: 'invalid-n', make: get('/q?n=abc&b=true') },
		{ id: 'missing', make: get('/q') }
	]
})

corpus.push({
	id: 'query-scalar-fused-grammar',
	tags: ['safe-for-socket', 'query', 'schema'],
	define: (app) =>
		app
			.get(
				'/qf',
				{
					query: t.Object({
						name: t.String(),
						page: t.Number(),
						limit: t.Integer(),
						active: t.Boolean(),
						optional: t.Optional(t.Number()),
						fallback: t.Number({ default: '3' as any })
					})
				},
				({ query }) => query
			)
				.get(
					'/qfc',
				{
					query: t.Object(
						{ page: t.Number() },
						{ additionalProperties: false }
					)
				},
					({ query }) => query
				)
				.post(
					'/qfp',
					{
						body: t.Object({ value: t.Number() }),
						query: t.Object({ page: t.Number() })
					},
					({ body, query }) => ({ body, query })
				),
	requests: [
		{
			id: 'encoded-plus-unknown-default',
			make: get(
				'/qf?name=' +
					encodeURIComponent('hello world') +
					'&page=.5&limit=-2&active=false&ignored=yes'
			)
		},
		{
			id: 'last-duplicate-wins',
			make: get(
				'/qf?active=true&limit=1&limit=10&page=bad&page=2&name=elysia'
			)
		},
		{
			id: 'last-invalid-uses-oracle',
			make: get('/qf?name=elysia&page=2&page=bad&limit=10&active=true')
		},
		{
			id: 'empty-and-required',
			make: get('/qf?name=&page=&limit=10&active=true')
		},
			{
				id: 'closed-additional-uses-oracle',
				make: get('/qfc?page=2&unknown=yes')
			},
			{
				id: 'body-parse-error-precedes-query-error',
				make: () =>
					new Request(url('/qfp?page=bad'), {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: '{'
					})
			}
	]
})

corpus.push({
	id: 'query-object',
	tags: ['safe-for-socket', 'query', 'schema'],
	define: (app) =>
		app.get(
			'/qo',
			{
				query: t.Object({
					filter: t.Object({ min: t.Numeric(), max: t.Numeric() })
				})
			},
			({ query }) => query
		),
	requests: [
		{
			id: 'object-in-query',
			make: get('/qo?filter=' + encodeURIComponent('{"min":1,"max":9}'))
		},
		{
			id: 'extra-key',
			make: get(
				'/qo?filter=' +
					encodeURIComponent('{"min":1,"max":9}') +
					'&extra=ignored'
			)
		}
	]
})

corpus.push({
	id: 'query-fused-error-order',
	tags: ['query', 'schema'],
	define: (app) =>
		app
			.error(({ query }: any) => ({ queryType: typeof query.page }))
			.post(
				'/qfe',
				{
					body: t.Object({ value: t.Number() }),
					query: t.Object({ page: t.Number() })
				},
				({ body, query }) => ({ body, query })
			),
	requests: [
		{
			id: 'body-error-sees-raw-query',
			make: () =>
				new Request(url('/qfe?page=1'), {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: '{'
				})
		}
	]
})

corpus.push({
	id: 'query-array-grammar',
	tags: ['safe-for-socket', 'query', 'schema'],
	define: (app) =>
		app.get(
			'/qa',
			{
				query: t.Object({
					ids: t.Array(t.String()),
					rows: t.Array(t.Object({ n: t.Numeric() }))
				})
			},
			({ query }) => query
		),
	requests: [
		{
			id: 'comma-bracket-repeat-and-object',
			make: get(
				'/qa?ids=a,b&ids=[c,d]&rows=' +
					encodeURIComponent('{"n":1}') +
					'&rows=' +
					encodeURIComponent('{"n":"2"}')
			)
		},
		{
			id: 'empty-array',
			make: get('/qa?ids=[]&rows=[]')
		}
	]
})

corpus.push({
	id: 'query-plan-fallbacks',
	tags: ['safe-for-socket', 'query', 'schema'],
	define: (app) => {
		const standard = {
			'~standard': {
				version: 1,
				vendor: 'd2-query',
				validate: (value: unknown) => ({ value })
			}
		}

		return app
			.model('QueryIds', t.Object({ id: t.Array(t.String()) }))
			.get('/query-ref', { query: 'QueryIds' }, ({ query }) => query)
			.get(
				'/query-standard',
				{ query: standard as any },
				({ query }) => query
			)
	},
	requests: [
		{
			id: 'model-ref-array',
			make: get('/query-ref?id=a&id=b')
		},
		{
			id: 'standard-generic-last-wins',
			make: get('/query-standard?id=a&id=b')
		}
	]
})

corpus.push({
	id: 'json-body',
	tags: ['safe-for-socket', 'body', 'schema'],
	define: (app) =>
		app.post(
			'/echo',
			{ body: t.Object({ n: t.Number(), s: t.String() }) },
			({ body }) => body
		),
	requests: [
		{ id: 'valid', make: json('/echo', { n: 1, s: 'a' }) },
		{ id: 'invalid-422', make: json('/echo', { n: 'x', s: 'a' }) },
		{
			id: 'wrong-content-type',
			make: () =>
				new Request(url('/echo'), {
					method: 'POST',
					headers: { 'content-type': 'text/plain' },
					body: JSON.stringify({ n: 1, s: 'a' })
				})
		},
		{
			id: 'malformed-json',
			make: () =>
				new Request(url('/echo'), {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: '{"n":1,'
				})
		},
		{
			id: 'proto-key',
			make: () =>
				new Request(url('/echo'), {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: '{"n":1,"s":"a","__proto__":{"polluted":true}}'
				})
		}
	]
})

corpus.push({
	id: 'multipart-form',
	tags: ['safe-for-socket', 'body', 'form'],
	define: (app) =>
		app.post(
			'/form',
			{ body: t.Object({ name: t.String(), age: t.Numeric() }) },
			({ body }) => body
		),
	requests: [
		{
			id: 'valid',
			make: () => {
				const fd = new FormData()
				fd.append('name', 'ada')
				fd.append('age', '36')
				return new Request(url('/form'), { method: 'POST', body: fd })
			}
		}
	]
})

corpus.push({
	id: 'urlencoded-body',
	tags: ['safe-for-socket', 'body', 'form'],
	define: (app) =>
		app.post(
			'/urlenc',
			{ body: t.Object({ name: t.String(), age: t.Numeric() }) },
			({ body }) => body
		),
	requests: [
		{
			id: 'valid',
			make: () =>
				new Request(url('/urlenc'), {
					method: 'POST',
					headers: {
						'content-type': 'application/x-www-form-urlencoded'
					},
					body: 'name=grace&age=85'
				})
		}
	]
})

corpus.push({
	id: 'headers',
	tags: ['safe-for-socket', 'headers', 'schema'],
	define: (app) =>
		app.get(
			'/h',
			{ headers: t.Object({ 'x-token': t.String() }) },
			({ headers }) => `token=${headers['x-token']}`
		),
	requests: [
		{
			id: 'valid',
			make: () =>
				new Request(url('/h'), { headers: { 'x-token': 'secret' } })
		},
		{
			// A socket adds its port to the host echoed by the 422 response.
			id: 'missing-422',
			make: get('/h'),
			tags: ['handle-only']
		}
	]
})

corpus.push({
	id: 'cookies',
	tags: ['safe-for-socket', 'cookies'],
	define: (app) =>
		app
			.get(
				'/cookie/read',
				({ cookie }: any) => `v=${cookie.session?.value ?? 'none'}`
			)
			.get('/cookie/write-one', ({ cookie }: any) => {
				cookie.session.value = 'abc'
				return 'set'
			})
			.get('/cookie/write-many', ({ cookie }: any) => {
				cookie.a.value = '1'
				cookie.b.value = '2'
				return 'set-many'
			})
			.get('/cookie/attrs', ({ cookie }: any) => {
				cookie.token.set({
					value: 'xyz',
					httpOnly: true,
					path: '/api',
					maxAge: 3600
				})
				return 'set-attrs'
			}),
	requests: [
		{
			id: 'read',
			make: () =>
				new Request(url('/cookie/read'), {
					headers: { cookie: 'session=hello' }
				})
		},
		{ id: 'write-one', make: get('/cookie/write-one') },
		{ id: 'write-many', make: get('/cookie/write-many') },
		{ id: 'write-attrs', make: get('/cookie/attrs') }
	]
})

corpus.push({
	id: 'response-schema',
	tags: ['safe-for-socket', 'schema', 'response'],
	define: (app) => {
		const Coded = t
			.Codec(t.String())
			.Decode((s: string) => Number(s.replace(/^n:/, '')))
			.Encode((n: number) => `n:${n}`)
		return app
			.get(
				'/resp',
				{ response: t.Object({ v: t.Number(), ok: t.Boolean() }) },
				() => ({ v: 42, ok: true })
			)
			.get('/resp-codec', { response: t.Object({ v: Coded }) }, () => ({
				v: 7
			}))
	},
	requests: [
		{ id: 'plain', make: get('/resp') },
		{ id: 'codec-encode', make: get('/resp-codec') }
	]
})

corpus.push({
	id: 'errors',
	tags: ['safe-for-socket', 'error'],
	define: (app) =>
		app
			.get('/throw', () => {
				throw new Error('boom')
			})
			.get('/status-return', () => status(418, 'teapot'))
			.get('/status-throw', () => {
				throw status(418, 'teapot')
			})
			.get('/redirect', () => redirect('http://localhost/dest', 302))
			.get('/dest', () => 'arrived'),
	requests: [
		{ id: 'not-found', make: get('/does-not-exist') },
		{ id: 'thrown-error', make: get('/throw') },
		{ id: 'status-return', make: get('/status-return') },
		{ id: 'status-throw', make: get('/status-throw') },
		{ id: 'redirect', make: get('/redirect') }
	]
})

class TeapotError extends Error {
	code = 'TEAPOT'
	status = 418
	constructor() {
		super('i-am-a-teapot')
	}
}
corpus.push({
	id: 'custom-error',
	tags: ['safe-for-socket', 'error'],
	define: (app) =>
		(app as any)
			.error(TeapotError, ({ error, set }: any) => {
				set.status = 418
				return { handled: (error as TeapotError).code }
			})
			.get('/custom', () => {
				throw new TeapotError()
			}),
	requests: [{ id: 'thrown-custom', make: get('/custom') }]
})

corpus.push({
	id: 'empty-bodies',
	tags: ['safe-for-socket', 'response'],
	define: (app) =>
		app
			.get('/empty-string', () => '')
			.get('/null', () => null)
			.get('/undefined', () => undefined)
			.get('/no-content', ({ set }: any) => {
				set.status = 204
				return null
			}),
	requests: [
		{ id: 'empty-string', make: get('/empty-string') },
		{ id: 'null', make: get('/null') },
		{ id: 'undefined', make: get('/undefined') },
		{ id: 'status-204', make: get('/no-content') }
	]
})

corpus.push({
	id: 'streams',
	tags: ['safe-for-socket', 'stream'],
	define: (app) =>
		app
			.get('/gen', async function* () {
				yield 'chunk-a'
				yield 'chunk-b'
				yield 'chunk-c'
			})
			.get('/bytes', () => {
				const payload = new Uint8Array([0, 1, 2, 3, 255, 254, 253])
				return new ReadableStream<Uint8Array>({
					start(controller) {
						controller.enqueue(payload.slice(0, 3))
						controller.enqueue(payload.slice(3))
						controller.close()
					}
				})
			}),
	requests: [
		{ id: 'generator', make: get('/gen') },
		{ id: 'raw-bytes', make: get('/bytes') }
	]
})

corpus.push({
	id: 'lifecycle',
	tags: ['safe-for-socket', 'lifecycle'],
	define: (app) =>
		app
			.request(({ request }: any) => {
				if (new URL(request.url).pathname === '/req-gate')
					return 'REQ-GATED'
			})
			.derive(() => ({ derived: 'D-value' }))
			.get(
				'/before',
				{ beforeHandle: () => 'BEFORE-WINS' },
				() => 'handler-body'
			)
			.get('/derived', ({ derived }: any) => `d=${derived}`)
			.get('/req-gate', () => 'handler-should-not-run'),
	requests: [
		{ id: 'before-short-circuit', make: get('/before') },
		{ id: 'request-hook-early-return', make: get('/req-gate') },
		{ id: 'derive-visible', make: get('/derived') }
	]
})

corpus.push({
	id: 'plugins-nested',
	tags: ['safe-for-socket', 'plugin', 'lifecycle'],
	define: (app) => {
		const inner = new Elysia()
			.guard({
				beforeHandle: ({ set }: any) => {
					set.headers['x-inner-guard'] = 'fired'
				}
			})
			.get('/inner', () => 'inner-body')
		const middle = new Elysia()
			.use(inner)
			.get('/middle', () => 'middle-body')
		return app
			.use(middle)
			.group('/grp', (g) =>
				g
					.guard({
						beforeHandle: ({ set }: any) => {
							set.headers['x-grp-guard'] = 'fired'
						}
					})
					.get('/leaf', () => 'grp-leaf')
			)
			.get('/top', () => 'top-body')
	},
	requests: [
		{ id: 'top', make: get('/top') },
		{ id: 'via-middle', make: get('/middle') },
		{ id: 'via-inner-plugin', make: get('/inner') },
		{ id: 'group-leaf', make: get('/grp/leaf') }
	]
})

corpus.push({
	id: 'scoped-ordering',
	tags: ['safe-for-socket', 'plugin', 'lifecycle'],
	define: (app) => {
		const scoped = new Elysia().beforeHandle('plugin', ({ set }) => {
			set.headers['x-scoped'] = 'yes'
		})
		return app.use(scoped).get('/after-scoped', () => 'ok')
	},
	requests: [{ id: 'after-scoped', make: get('/after-scoped') }]
})

corpus.push({
	id: 'async-native-promise',
	tags: ['safe-for-socket', 'async'],
	define: (app) =>
		app
			.get('/promise', async () => 'promise-value')
			.get(
				'/bh-promise',
				{ beforeHandle: async () => 'bh-promise-wins' },
				() => 'handler'
			),
	requests: [
		{ id: 'handler-promise', make: get('/promise') },
		{ id: 'beforehandle-promise', make: get('/bh-promise') }
	]
})

// Custom thenables are serialized as plain objects rather than awaited.
corpus.push({
	id: 'async-thenable',
	tags: ['safe-for-socket', 'async', 'custom-thenable'],
	define: (app) =>
		app
			.get('/thenable', () => makeThenable('thenable-value') as any)
			.get(
				'/bh-thenable',
				{ beforeHandle: () => makeThenable('bh-thenable-wins') as any },
				() => 'handler'
			),
	requests: [
		{ id: 'handler-thenable', make: get('/thenable') },
		{ id: 'beforehandle-thenable', make: get('/bh-thenable') }
	]
})

// A throwing `then` getter follows the normal error path.
corpus.push({
	id: 'throwing-then-getter',
	tags: [
		'safe-for-socket',
		'async',
		'custom-thenable',
		'throwing-then-getter'
	],
	define: (app) =>
		app.get('/throwing-then', () => makeThrowingThenGetter() as any),
	requests: [{ id: 'handler-throwing-then', make: get('/throwing-then') }]
})

// A real socket cannot receive `http://a/` as its request URL.
corpus.push({
	id: 'short-host',
	tags: ['handle-only', 'path', 'short-host'],
	define: (app) => app.get('/', () => 'root'),
	requests: [{ id: 'short-host-root', make: () => new Request('http://a/') }]
})

{
	const recorder = makeRecorder()
	corpus.push({
		id: 'observed-lifecycle',
		tags: ['safe-for-socket', 'observe', 'lifecycle'],
		recorder,
		define: (app) =>
			app.get(
				'/observed',
				{
					transform() {
						recorder.events.push('transform')
					},
					beforeHandle() {
						recorder.events.push('beforeHandle')
					},
					afterHandle() {
						recorder.events.push('afterHandle')
					}
				},
				() => {
					recorder.events.push('handler')
					return 'observed-ok'
				}
			),
		requests: [{ id: 'ordered-hooks', make: get('/observed') }]
	})
}

corpus.push({
	id: 'async-validator',
	tags: ['safe-for-socket', 'body', 'schema', 'async'],
	define: (app) =>
		app.post(
			'/async-validate',
			{
				parse: async (c: any) => JSON.parse(await c.request.text()),
				body: t.Object({ x: t.String() })
			} as any,
			({ body }: any) => body
		),
	requests: [
		{ id: 'valid', make: json('/async-validate', { x: 'ok' }) },
		{ id: 'invalid-422', make: json('/async-validate', { x: 5 }) }
	]
})

corpus.push({
	id: 'beforehandle-promise-branches',
	tags: ['safe-for-socket', 'lifecycle', 'async'],
	define: (app) =>
		app
			.get(
				'/bh-continue',
				{ beforeHandle: () => Promise.resolve(undefined) } as any,
				() => 'handler-ran'
			)
			.get(
				'/bh-shortcircuit',
				{ beforeHandle: () => Promise.resolve('short-wins') } as any,
				() => 'handler-ran'
			),
	requests: [
		{ id: 'continue', make: get('/bh-continue') },
		{ id: 'short-circuit', make: get('/bh-shortcircuit') }
	]
})

corpus.push({
	id: 'async-throw-after-await',
	tags: ['safe-for-socket', 'error', 'async'],
	define: (app) =>
		app.get('/async-throw', async () => {
			await Promise.resolve()
			throw new Error('after-await-boom')
		}),
	requests: [{ id: 'throws', make: get('/async-throw') }]
})

corpus.push({
	id: 'signed-cookie',
	tags: ['safe-for-socket', 'cookies'],
	define: (app) =>
		app.get(
			'/signed',
			{
				cookie: t.Cookie(
					{ session: t.Optional(t.String()) },
					{ secrets: 'sekret', sign: ['session'] }
				)
			},
			({ cookie }: any) => {
				cookie.session.value = 'signed-value'
				return 'signed'
			}
		),
	requests: [{ id: 'write-signed', make: get('/signed') }]
})

{
	const recorder = makeRecorder()
	corpus.push({
		id: 'observed-after-response',
		tags: ['safe-for-socket', 'observe', 'lifecycle'],
		recorder,
		define: (app) =>
			app.get(
				'/observed-ar',
				{
					afterResponse() {
						recorder.events.push('afterResponse')
					}
				},
				() => {
					recorder.events.push('handler')
					return 'ar-ok'
				}
			),
		requests: [{ id: 'exactly-once', make: get('/observed-ar') }]
	})
}
