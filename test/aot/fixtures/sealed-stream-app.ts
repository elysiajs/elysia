import { Elysia, sse, t } from 'elysia'

const object = t.Object({ a: t.Number() })

const standard = {
	'~standard': {
		version: 1,
		vendor: 'test',
		validate: (value: any) =>
			typeof value?.a === 'number'
				? { value: { a: value.a } }
				: { issues: [{ message: 'a' }] }
	}
}

// Every response is frozen, so a generator's chunks need no live mirror.
export const app = new Elysia()
	.get('/plain', { response: object }, function* (): Generator<any> {
		yield { a: 1, secret: 'x' }
		yield { a: 2, secret: 'x' }
	})
	.get(
		'/sse',
		{ response: t.Object({ data: t.Object({ name: t.String() }) }) },
		function* (): Generator<any> {
			yield sse({ event: 'e', id: 1, data: { name: 'a', secret: 'x' } })
		}
	)
	.get('/mismatch', { response: object }, function* (): Generator<any> {
		yield 'text'
		yield { b: 1, secret: 'x' }
		yield { a: 1, secret: 'x' }
	})
	.get(
		'/framed',
		{ response: t.Object({ data: t.Object({ name: t.String() }) }) },
		() =>
			sse(
				(function* () {
					yield { name: 'a', secret: 'x' }
				})()
			)
	)
	.get(
		'/throw',
		{ response: t.Object({ a: t.Object({ y: t.String() }) }) },
		function* (): Generator<any> {
			yield { a: null, secret: 'x' }
		}
	)
	.get('/standard', { response: standard }, function* (): Generator<any> {
		yield { a: 1, secret: 'x' }
		yield { a: 'text' }
	})
