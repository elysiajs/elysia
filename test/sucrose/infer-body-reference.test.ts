import { describe, it, expect } from 'bun:test'
import { inferBodyReference, Sucrose } from '../../src/sucrose'

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
			route: false
		} satisfies Sucrose.Inference

		inferBodyReference(code, aliases, inference)

		expect(inference.body as boolean).toBe(true)
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
			route: false
		} satisfies Sucrose.Inference

		inferBodyReference(code, aliases, inference)

		expect(inference.body as boolean).toBe(true)
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
			route: false
		} satisfies Sucrose.Inference

		inferBodyReference(code, aliases, inference)

		expect(inference).toEqual({
			body: false,
			cookie: false,
			headers: false,
			query: true,
			set: true,
			route: false
		})
	})

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
			route: false
		} satisfies Sucrose.Inference

		inferBodyReference(code, aliases, inference)

		expect(inference).toEqual({
			body: false,
			cookie: false,
			headers: false,
			query: true,
			set: true,
			route: false
		})
	})

	it('infer dot notation', () => {
		const code = `
			context.set?.headers
		`
		const aliases = ['context']
		const inference = {
			query: false,
			headers: false,
			body: false,
			cookie: false,
			set: false,
			route: false
		} satisfies Sucrose.Inference

		inferBodyReference(code, aliases, inference)

		expect(inference.set as boolean).toBe(true)
	})
})
