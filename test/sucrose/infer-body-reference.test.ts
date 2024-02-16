import { describe, it, expect } from 'bun:test'
import { inferBodyReference } from '../../src/sucrose'

describe('infer body reference', () => {
	it('infer dot notation', () => {
		const code = 'context.body.a'
		const aliases = ['context']
		const inference = {
			queries: [],
			query: false,
			headers: false,
			body: false,
			cookie: false,
			set: false
		}

		inferBodyReference(code, aliases, inference)

		expect(inference.body).toBe(true)
	})

	it('infer property access', () => {
		const code = 'context["body"]["a"]'
		const aliases = ['context']
		const inference = {
			queries: [],
			query: false,
			headers: false,
			body: false,
			cookie: false,
			set: false
		}

		inferBodyReference(code, aliases, inference)

		expect(inference.body).toBe(true)
	})

	it('infer all inferences if passed to function', () => {
		const code = 'a(context)'
		const aliases = ['context']
		const inference = {
			queries: [],
			query: false,
			headers: false,
			body: false,
			cookie: false,
			set: false
		}

		inferBodyReference(code, aliases, inference)

		expect(inference).toEqual({
			queries: [],
			query: true,
			headers: true,
			body: true,
			cookie: true,
			set: true
		})
	})

	it('infer multiple query', () => {
		const code = `{
  console.log({ a: query.quack }, {
    b: query.duck
  });
  const b = query.quack;
  return "a";
}`

		const aliases = ['query']
		const inference = {
			body: false,
			cookie: false,
			headers: false,
			queries: ['quack', 'duck'],
			query: true,
			set: true
		}

		inferBodyReference(code, aliases, inference)

		expect(inference).toEqual({
			body: false,
			cookie: false,
			headers: false,
			queries: ['quack', 'duck'],
			query: true,
			set: true
		})
	})
})
