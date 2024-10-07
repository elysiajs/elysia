// /* eslint-disable @typescript-eslint/no-unused-vars */
// import { expect } from 'bun:test'
// import { t, Elysia, RouteSchema, Cookie, error } from '../../../src'
// import { expectTypeOf } from 'expect-type'

// // Inline Derive
// {
// 	new Elysia().get(
// 		'/',
// 		({ name }) => {
// 			expectTypeOf<typeof name>().toEqualTypeOf<'hare'>()
// 		},
// 		{
// 			derive: () => {
// 				return { name: 'hare' as const }
// 			}
// 		}
// 	)
// }

// // Inline Derive Array
// {
// 	new Elysia().get(
// 		'/',
// 		({ first, last }) => {
// 			expectTypeOf<typeof first>().toEqualTypeOf<'hare'>()
// 			expectTypeOf<typeof last>().toEqualTypeOf<'omagari'>()
// 		},
// 		{
// 			derive: [
// 				() => {
// 					return { first: 'hare' as const }
// 				},
// 				() => {
// 					return { last: 'omagari' as const }
// 				}
// 			]
// 		}
// 	)
// }

// // Inline Derive Array
// {
// 	new Elysia().get(
// 		'/',
// 		({ first, last }) => {
// 			expectTypeOf<typeof first>().toEqualTypeOf<'hare'>()
// 			expectTypeOf<typeof last>().toEqualTypeOf<'omagari'>()
// 		},
// 		{
// 			derive: [
// 				() => {
// 					return { first: 'hare' as const }
// 				},
// 				() => {
// 					return { last: 'omagari' as const }
// 				}
// 			]
// 		}
// 	)
// }

// // ? Group Derive
// {
// 	new Elysia()
// 		.guard(
// 			{
// 				derive: () => ({ hi: 'hare' as const })
// 			},
// 			(app) =>
// 				app.get('/', ({ hi }) => {
// 					expectTypeOf<typeof hi>().toEqualTypeOf<'hare'>()
// 				})
// 		)
// 		.get('/nope', (context) => {
// 			expectTypeOf<typeof context>().not.toHaveProperty('hi')
// 		})
// }

// // ? Group Derive
// {
// 	new Elysia()
// 		.guard(
// 			{
// 				derive: [
// 					() => ({ first: 'hare' as const }),
// 					() => ({ last: 'omagari' as const })
// 				]
// 			},
// 			(app) =>
// 				app.get('/', ({ first, last }) => {
// 					expectTypeOf<typeof first>().toEqualTypeOf<'hare'>()
// 					expectTypeOf<typeof last>().toEqualTypeOf<'omagari'>()
// 				})
// 		)
// 		.get('/nope', (context) => {
// 			expectTypeOf<typeof context>().not.toHaveProperty('first')
// 			expectTypeOf<typeof context>().not.toHaveProperty('last')
// 		})
// }

// // ? Guard Derive
// {
// 	const plugin = new Elysia()
// 		.guard({
// 			derive: () => ({ name: 'hare' as const })
// 		})
// 		.get('/', ({ name }) => {
// 			expectTypeOf<typeof name>().toEqualTypeOf<'hare'>()
// 		})

// 	new Elysia().use(plugin).get('/', (context) => {
// 		expectTypeOf<typeof context>().not.toHaveProperty('name')
// 	})
// }

// // ? Guard Derive Array
// {
// 	new Elysia()
// 		.guard({
// 			derive: [
// 				() => ({ first: 'hare' as const }),
// 				() => ({ last: 'omagari' as const })
// 			]
// 		})
// 		.get('/', ({ first, last }) => {
// 			expectTypeOf<typeof first>().toEqualTypeOf<'hare'>()
// 			expectTypeOf<typeof last>().toEqualTypeOf<'omagari'>()
// 		})
// }

// // ? Scoped Derive
// {
// 	const plugin = new Elysia()
// 		.guard({
// 			as: 'scoped',
// 			derive: () => ({ name: 'hare' as const })
// 		})
// 		.get('/', ({ name }) => {
// 			expectTypeOf<typeof name>().toEqualTypeOf<'hare'>()
// 		})

// 	const app = new Elysia().use(plugin).get('/', ({ name }) => {
// 		expectTypeOf<typeof name>().toEqualTypeOf<'hare'>()
// 	})

// 	const root = new Elysia().use(app).get('/', (context) => {
// 		expectTypeOf<typeof context>().not.toHaveProperty('name')
// 	})
// }

// // ? Global Derive
// {
// 	const plugin = new Elysia()
// 		.guard({
// 			as: 'global',
// 			derive: () => ({ name: 'hare' as const })
// 		})
// 		.get('/', ({ name }) => {
// 			expectTypeOf<typeof name>().toEqualTypeOf<'hare'>()
// 		})

// 	const app = new Elysia().use(plugin).get('/', ({ name }) => {
// 		expectTypeOf<typeof name>().toEqualTypeOf<'hare'>()
// 	})

// 	new Elysia().use(app).get('/', ({ name }) => {
// 		expectTypeOf<typeof name>().toEqualTypeOf<'hare'>()
// 	})
// }
