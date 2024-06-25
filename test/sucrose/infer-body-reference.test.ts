import { describe, it, expect } from 'bun:test'
import { inferBodyReference } from '../../src/sucrose'

describe('infer body reference', () => {
	it('infer dot notation', () => {
		const code = 'context.body.a'
		const aliases = ['context']
		const inference = {
			query: false,
			headers: false,
			body: false,
			cookie: false,
			set: false,
			server: false
		}

		inferBodyReference(code, aliases, inference)

		expect(inference.body).toBe(true)
	})

	it('infer property access', () => {
		const code = 'context["body"]["a"]'
		const aliases = ['context']
		const inference = {
			query: false,
			headers: false,
			body: false,
			cookie: false,
			set: false,
			server: false
		}

		inferBodyReference(code, aliases, inference)

		expect(inference.body).toBe(true)
	})

	it('infer multiple query', () => {
		const code = `{
			console.log({ a: query.quack }, {
				b: query.duck
			});
			const b = query.bark;
			return "a";
		}`

		const aliases = ['query']
		const inference = {
			body: false,
			cookie: false,
			headers: false,
			query: true,
			set: true,
			server: false
		}

		inferBodyReference(code, aliases, inference)

		expect(inference).toEqual({
			body: false,
			cookie: false,
			headers: false,
			query: true,
			set: true,
			server: false
		})
	})

	// This is not use in Bun
	// it('infer single quote query', () => {
	// 	const code = `{
	// 		const b = query['quack'];
	// 		return "a";
	// 	}`

	// 	const aliases = ['query']
	// 	const inference = {
	// 		body: false,
	// 		cookie: false,
	// 		headers: false,
	// 		queries: <string[]>[],
	// 		query: true,
	// 		set: true,
	// 		unknownQueries: false
	// 	}

	// 	inferBodyReference(code, aliases, inference)

	// 	expect(inference).toEqual({
	// 		body: false,
	// 		cookie: false,
	// 		headers: false,
	// 		queries: ['quack'],
	// 		query: true,
	// 		set: true,
	// 		unknownQueries: false
	// 	})
	// })

	// it('infer double quote query', () => {
	// 	const code = `{
	// 		const b = query["quack"];
	// 		return "a";
	// 	}`

	// 	const aliases = ['query']
	// 	const inference = {
	// 		body: false,
	// 		cookie: false,
	// 		headers: false,
	// 		queries: <string[]>[],
	// 		query: true,
	// 		set: true,
	// 		unknownQueries: false
	// 	}

	// 	inferBodyReference(code, aliases, inference)

	// 	expect(inference).toEqual({
	// 		body: false,
	// 		cookie: false,
	// 		headers: false,
	// 		queries: ['quack'],
	// 		query: true,
	// 		set: true,
	// 		unknownQueries: false
	// 	})
	// })

	it('skip dynamic quote query', () => {
		const code = `{
			const b = query[quack];
			return "a";
		}`

		const aliases = ['query']
		const inference = {
			body: false,
			cookie: false,
			headers: false,
			query: true,
			set: true,
			server: false
		}

		inferBodyReference(code, aliases, inference)

		expect(inference).toEqual({
			body: false,
			cookie: false,
			headers: false,
			query: true,
			set: true,
			server: false
		})
	})

	it('infer dot notation', () => {
		const code = `
			context.server?.upgrade(request)
		`
		const aliases = ['context']
		const inference = {
			query: false,
			headers: false,
			body: false,
			cookie: false,
			set: false,
			server: false
		}

		inferBodyReference(code, aliases, inference)

		expect(inference.server).toBe(true)
	})
})
