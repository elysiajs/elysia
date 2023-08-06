import { Elysia, t } from '../src'

import { describe, expect, it } from 'bun:test'
import { req } from './utils'

describe('Models', () => {
	it('register models', async () => {
		const app = new Elysia()
			.model({
				string: t.String(),
				number: t.Number()
			})
			.model({
				boolean: t.Boolean()
			})
			// @ts-ignore
			.route('GET', '/', (context) => Object.keys(context.defs!), {
				config: {
					allowMeta: true
				}
			})

		const res = await app.handle(req('/')).then((r) => r.json())

		expect(res).toEqual(['string', 'number', 'boolean'])
	})

	// it('map model parameters as OpenAPI schema', async () => {
	// 	const app = new Elysia()
	// 		.model({
	// 			number: t.Number(),
	// 			string: t.String(),
	// 			boolean: t.Boolean(),
	// 			object: t.Object({
	// 				string: t.String(),
	// 				boolean: t.Boolean()
	// 			})
	// 		})
	// 		.get('/defs', (context) => context[SCHEMA])
	// 		.get('/', () => 1, {
	// 			schema: {
	// 				query: 'object',
	// 				body: 'object',
	// 				params: 'object',
	// 				response: {
	// 					200: 'boolean',
	// 					300: 'number'
	// 				}
	// 			} as const
	// 		})

	// 	const res = await app.handle(req('/defs')).then((r) => r.json())

	// 	expect(res).toEqual({
	// 		'/defs': {
	// 			get: {}
	// 		},
	// 		'/': {
	// 			get: {
	// 				parameters: [
	// 					{
	// 						in: 'path',
	// 						name: 'string',
	// 						type: 'string',
	// 						required: true
	// 					},
	// 					{
	// 						in: 'path',
	// 						name: 'boolean',
	// 						type: 'boolean',
	// 						required: true
	// 					},
	// 					{
	// 						in: 'query',
	// 						name: 'string',
	// 						type: 'string',
	// 						required: true
	// 					},
	// 					{
	// 						in: 'query',
	// 						name: 'boolean',
	// 						type: 'boolean',
	// 						required: true
	// 					},
	// 					{
	// 						in: 'body',
	// 						name: 'body',
	// 						required: true,
	// 						schema: {
	// 							$ref: '#/definitions/object'
	// 						}
	// 					}
	// 				],
	// 				responses: {
	// 					'200': {
	// 						schema: {
	// 							$ref: '#/definitions/boolean'
	// 						}
	// 					},
	// 					'300': {
	// 						schema: {
	// 							$ref: '#/definitions/number'
	// 						}
	// 					}
	// 				}
	// 			}
	// 		}
	// 	})
	// })

	// it('map model and inline parameters as OpenAPI schema', async () => {
	// 	const app = new Elysia()
	// 		.model({
	// 			number: t.Number(),
	// 			string: t.String(),
	// 			boolean: t.Boolean(),
	// 			object: t.Object({
	// 				string: t.String(),
	// 				boolean: t.Boolean()
	// 			})
	// 		})
	// 		.get('/defs', (context) => context[SCHEMA])
	// 		.get('/', () => 1, {
	// 			schema: {
	// 				query: 'object',
	// 				body: t.Object({
	// 					number: t.Number()
	// 				}),
	// 				params: 'object',
	// 				response: {
	// 					200: 'boolean',
	// 					300: 'number'
	// 				}
	// 			} as const
	// 		})

	// 	const res = await app.handle(req('/defs')).then((r) => r.json())

	// 	expect(res).toEqual({
	// 		'/defs': {
	// 			get: {}
	// 		},
	// 		'/': {
	// 			get: {
	// 				parameters: [
	// 					{
	// 						in: 'path',
	// 						name: 'string',
	// 						type: 'string',
	// 						required: true
	// 					},
	// 					{
	// 						in: 'path',
	// 						name: 'boolean',
	// 						type: 'boolean',
	// 						required: true
	// 					},
	// 					{
	// 						in: 'query',
	// 						name: 'string',
	// 						type: 'string',
	// 						required: true
	// 					},
	// 					{
	// 						in: 'query',
	// 						name: 'boolean',
	// 						type: 'boolean',
	// 						required: true
	// 					},
	// 					{
	// 						in: 'body',
	// 						name: 'body',
	// 						required: true,
	// 						schema: {
	// 							type: 'object',
	// 							properties: {
	// 								number: {
	// 									type: 'number'
	// 								}
	// 							},
	// 							required: ['number'],
	// 							additionalProperties: false
	// 						}
	// 					}
	// 				],
	// 				responses: {
	// 					'200': {
	// 						schema: {
	// 							$ref: '#/definitions/boolean'
	// 						}
	// 					},
	// 					'300': {
	// 						schema: {
	// 							$ref: '#/definitions/number'
	// 						}
	// 					}
	// 				}
	// 			}
	// 		}
	// 	})
	// })

	// it('map model and inline response as OpenAPI schema', async () => {
	// 	const app = new Elysia()
	// 		.model({
	// 			number: t.Number(),
	// 			string: t.String(),
	// 			boolean: t.Boolean(),
	// 			object: t.Object({
	// 				string: t.String(),
	// 				boolean: t.Boolean()
	// 			})
	// 		})
	// 		.get('/defs', (context) => context[SCHEMA])
	// 		.get('/', () => 1, {
	// 			schema: {
	// 				response: {
	// 					200: t.String(),
	// 					300: 'number'
	// 				}
	// 			} as const
	// 		})

	// 	const res = await app.handle(req('/defs')).then((r) => r.json())

	// 	expect(res).toEqual({
	// 		'/defs': {
	// 			get: {}
	// 		},
	// 		'/': {
	// 			get: {
	// 				responses: {
	// 					'200': {
	// 						schema: {
	// 							type: 'string'
	// 						}
	// 					},
	// 					'300': {
	// 						schema: {
	// 							$ref: '#/definitions/number'
	// 						}
	// 					}
	// 				}
	// 			}
	// 		}
	// 	})
	// })

	// it('map model default response', async () => {
	// 	const app = new Elysia()
	// 		.model({
	// 			number: t.Number(),
	// 			string: t.String(),
	// 			boolean: t.Boolean(),
	// 			object: t.Object({
	// 				string: t.String(),
	// 				boolean: t.Boolean()
	// 			})
	// 		})
	// 		.get('/defs', (context) => context[SCHEMA])
	// 		.get('/', () => 1, {
	// 			schema: {
	// 				response: 'number'
	// 			} as const
	// 		})

	// 	const res = await app.handle(req('/defs')).then((r) => r.json())

	// 	expect(res).toEqual({
	// 		'/defs': {
	// 			get: {}
	// 		},
	// 		'/': {
	// 			get: {
	// 				responses: {
	// 					'200': {
	// 						schema: {
	// 							$ref: '#/definitions/number'
	// 						}
	// 					}
	// 				}
	// 			}
	// 		}
	// 	})
	// })

	it('validate reference model', async () => {
		const app = new Elysia()
			.model({
				number: t.Number()
			})
			.post('/', ({ body: { data } }) => data, {
				response: 'number',
				body: t.Object({
					data: t.Number()
				})
			})

		const correct = await app.handle(
			new Request('http://localhost/', {
				method: 'POST',
				headers: {
					'content-type': 'application/json'
				},
				body: JSON.stringify({
					data: 1
				})
			})
		)

		expect(correct.status).toBe(200)

		const wrong = await app.handle(
			new Request('http://localhost/', {
				method: 'POST',
				headers: {
					'content-type': 'application/json'
				},
				body: JSON.stringify({
					data: true
				})
			})
		)

		expect(wrong.status).toBe(400)
	})
})
