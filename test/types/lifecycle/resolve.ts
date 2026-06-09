// /* eslint-disable @typescript-eslint/no-unused-vars */
// import { expect } from 'bun:test'
// import { t, Elysia, RouteSchema, Cookie, error } from '../../../src'
// import { expectTypeOf } from 'expect-type'

// // Inline Resolve
// {
// 	new Elysia().get(
// 		'/',
// 		({ name }) => {
// 			expectTypeOf<typeof name>().toEqualTypeOf<'hare'>()
// 		},
// 		{
// 			resolve: () => {
// 				return { name: 'hare' as const }
// 			}
// 		}
// 	)
// }

// // Inline Resolve Array
// {
// 	new Elysia().get(
// 		'/',
// 		({ first, last }) => {
// 			expectTypeOf<typeof first>().toEqualTypeOf<'hare'>()
// 			expectTypeOf<typeof last>().toEqualTypeOf<'omagari'>()
// 		},
// 		{
// 			resolve: [
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

// // Inline Resolve Array
// {
// 	new Elysia().get(
// 		'/',
// 		({ first, last }) => {
// 			expectTypeOf<typeof first>().toEqualTypeOf<'hare'>()
// 			expectTypeOf<typeof last>().toEqualTypeOf<'omagari'>()
// 		},
// 		{
// 			resolve: [
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

// // ? Group Resolve
// {
// 	new Elysia()
// 		.guard(
// 			{
// 				resolve: () => ({ hi: 'hare' as const })
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

// // ? Group Resolve
// {
// 	new Elysia()
// 		.guard(
// 			{
// 				resolve: [
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

// // ? Guard Resolve
// {
// 	const plugin = new Elysia()
// 		.guard({
// 			resolve: () => ({ name: 'hare' as const })
// 		})
// 		.get('/', ({ name }) => {
// 			expectTypeOf<typeof name>().toEqualTypeOf<'hare'>()
// 		})

// 	new Elysia().use(plugin).get('/', (context) => {
// 		expectTypeOf<typeof context>().not.toHaveProperty('name')
// 	})
// }

// // ? Guard Resolve Array
// {
// 	new Elysia()
// 		.guard({
// 			resolve: [
// 				() => ({ first: 'hare' as const }),
// 				() => ({ last: 'omagari' as const })
// 			]
// 		})
// 		.get('/', ({ first, last }) => {
// 			expectTypeOf<typeof first>().toEqualTypeOf<'hare'>()
// 			expectTypeOf<typeof last>().toEqualTypeOf<'omagari'>()
// 		})
// }

// // ? Scoped Resolve
// {
// 	const plugin = new Elysia()
// 		.guard({
// 			as: 'scoped',
// 			resolve: () => ({ name: 'hare' as const })
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

// // ? Global Resolve
// {
// 	const plugin = new Elysia()
// 		.guard({
// 			as: 'global',
// 			resolve: () => ({ name: 'hare' as const })
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

// // ? Macro resolve
// {
// 	const macro = new Elysia()
// 		.macro({
// 			a: () => ({
// 				resolve: () => ({
// 					message: 'hello' as const
// 				})
// 			})
// 		})
// 		.get(
// 			'/',
// 			({ message }) => {
// 				expectTypeOf<typeof message>().toEqualTypeOf<'hello'>()
// 			},
// 			{
// 				a: true
// 			}
// 		)

// 	const main = new Elysia().use(macro).get(
// 		'/',
// 		({ message }) => {
// 			expectTypeOf<typeof message>().toEqualTypeOf<'hello'>()
// 		},
// 		{
// 			a: true
// 		}
// 	)
// }
