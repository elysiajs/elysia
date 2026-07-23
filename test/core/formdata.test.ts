import { Elysia, t, form, file } from '../../src'
import { describe, expect, it } from 'bun:test'
import { fileTypeFromBlob } from 'file-type'
import { req } from '../utils'
import { formDataToObject } from '../../src/adapter/web-standard/utils'
import { TypeBoxValidator } from '../../src/type/validator'
import { setFileTypeDetector } from '../../src/type/elysia/file-type'

const snapshotObject = (value: Record<PropertyKey, unknown>) => ({
	values: Reflect.ownKeys(value).map((key) => [key, value[key]]),
	descriptors: Object.getOwnPropertyDescriptors(value),
	symbols: Object.getOwnPropertySymbols(value),
	prototype: Object.getPrototypeOf(value)
})

const expectUnchangedAfterFailure = async (
	validator: TypeBoxValidator<any>,
	value: Record<PropertyKey, unknown>,
	async: boolean
) => {
	const before = snapshotObject(value)

	if (async) await expect(validator.FromAsync(value)).rejects.toBeDefined()
	else expect(() => validator.FromSync(value)).toThrow()

	expect(snapshotObject(value)).toEqual(before)
}

describe('Form Data', () => {
	describe('failed validation preserves caller input', () => {
		for (const async of [false, true]) {
			const path = async ? 'async' : 'sync'

			it(`${path} schema check`, async () => {
				await expectUnchangedAfterFailure(
					new TypeBoxValidator(t.Form({ value: t.String() })),
					{ value: 1 },
					async
				)
			})

			it(`${path} codec decode`, async () => {
				await expectUnchangedAfterFailure(
					new TypeBoxValidator(
						t.Form({
							value: t
								.Codec(t.String())
								.Decode(() => {
									throw new Error('decode failed')
								})
								.Encode((value) => value)
						})
					),
					{ value: 'ok' },
					async
				)
			})

			it(`${path} normalized codec decode`, async () => {
				await expectUnchangedAfterFailure(
					new TypeBoxValidator(
						t.Form({
							value: t
								.Codec(t.String())
								.Decode(() => {
									throw new Error('decode failed')
								})
								.Encode((value) => value)
						}),
						{ normalize: 'typebox' }
					),
					{ value: 'ok' },
					async
				)
			})
		}

		it('async file type detection', async () => {
			setFileTypeDetector(async () => {
				throw new Error('detection failed')
			})
			const value = {
				file: new File(['content'], 'image.png', { type: 'image/png' })
			}
			const validator = new TypeBoxValidator(
				t.Form({ file: t.File({ type: 'image' }) }) as any
			)

			expect(validator.isAsync).toBe(true)
			try {
				await expectUnchangedAfterFailure(validator, value, true)
			} finally {
				setFileTypeDetector(fileTypeFromBlob)
			}
		})
	})

	it('return Bun.file', async () => {
		const app = new Elysia().get('/', () =>
			form({
				a: 'hello',
				b: Bun.file('test/kyuukurarin.mp4')
			})
		)

		const contentType = await app
			.handle(req('/'))
			.then((x) => x.headers.get('content-type'))

		expect(contentType).toStartWith('multipart/form-data')
	})

	it('return Elysia.file', async () => {
		const app = new Elysia().get('/', () =>
			form({
				a: 'hello',
				b: file('test/kyuukurarin.mp4')
			})
		)

		const contentType = await app
			.handle(req('/'))
			.then((x) => x.headers.get('content-type'))

		expect(contentType).toStartWith('multipart/form-data')
	})

	it('validate formdata', async () => {
		const app = new Elysia().get(
			'/',
			{
				response: t.Form({
					a: t.String(),
					b: t.File()
				})
			},
			() =>
				form({
					a: 'hello',
					b: file('test/kyuukurarin.mp4')
				})
		)

		const response = await app.handle(req('/'))

		expect(response.status).toBe(200)
		expect(response.headers.get('content-type')).toStartWith(
			'multipart/form-data'
		)
	})

	it('return single file', async () => {
		const app = new Elysia().get('/', () => file('test/kyuukurarin.mp4'))

		const response = await app.handle(req('/'))

		expect(response.status).toBe(200)
		expect(response.headers.get('content-type')).toStartWith('video/mp4')
	})

	it('inline single file', async () => {
		const app = new Elysia().get('/', file('test/kyuukurarin.mp4'))

		const response = await app.handle(req('/'))

		expect(response.status).toBe(200)
		expect(response.headers.get('content-type')).toStartWith('video/mp4')
	})
})

describe('Form Data JSON coercion', () => {
	const echo = () =>
		new Elysia().post('/', ({ body }) => body as Record<string, unknown>)

	const post = (form: FormData) =>
		echo()
			.handle(
				new Request('http://localhost/', { method: 'POST', body: form })
			)
			.then((x) => x.json())

	it('keeps an unclosed object-like field as a string', async () => {
		const form = new FormData()
		form.append('payload', '{aaaa')

		await expect(post(form)).resolves.toEqual({ payload: '{aaaa' })
	})

	it('keeps an unclosed array-like field as a string', async () => {
		const form = new FormData()
		form.append('payload', '[1,2,3')

		await expect(post(form)).resolves.toEqual({ payload: '[1,2,3' })
	})

	it('parses complete JSON object and array fields', async () => {
		const form = new FormData()
		form.append('meta', JSON.stringify({ id: '123', altText: 'an image' }))
		form.append('list', JSON.stringify([1, 2, 3]))

		await expect(post(form)).resolves.toEqual({
			meta: { id: '123', altText: 'an image' },
			list: [1, 2, 3]
		})
	})

	it('parses a large complete JSON object field', async () => {
		const big = { id: '1', blob: 'x'.repeat(200_000) }
		const form = new FormData()
		form.append('meta', JSON.stringify(big))

		await expect(post(form)).resolves.toEqual({ meta: big })
	})

	it('keeps JSON followed by whitespace as a string', async () => {
		const form = new FormData()
		form.append('payload', '{"a":1} ')

		await expect(post(form)).resolves.toEqual({ payload: '{"a":1} ' })
	})
})

describe('Form Data resource bounds', () => {
	it('normalizes 100,000 distinct keys within two seconds', () => {
		const form = new FormData()
		for (let i = 0; i < 100_000; i++) form.append('k' + i, 'v')

		const start = performance.now()
		const out = formDataToObject(form)
		const elapsed = performance.now() - start

		expect(out.k0).toBe('v')
		expect(out.k99999).toBe('v')
		expect(elapsed).toBeLessThan(2_000)
	})

	it('does not hang on an unterminated nested key', () => {
		for (const key of ['a[1', 'a[', "a['x", 'a["y']) {
			const form = new FormData()
			form.append(key, 'v')
			expect(() => formDataToObject(form)).not.toThrow()
		}
	})

	it('preserves nested + multi-value normalization', () => {
		const form = new FormData()
		form.append('a[0]', 'x')
		form.append('a[1]', 'y')
		form.append('b.c', 'z')
		form.append('tag', '1')
		form.append('tag', '2')

		expect(formDataToObject(form)).toEqual({
			a: ['x', 'y'],
			b: { c: 'z' },
			tag: ['1', '2']
		})
	})

	it('nested keys take precedence over colliding plain keys', () => {
		const form = new FormData()
		form.append('user.name', 'bob')
		form.append('user', 'HAX')
		form.append('user.age', '9')
		form.append('a[0]', 'x')
		form.append('a', 'flat')
		form.append('a[1]', 'y')

		expect(formDataToObject(form)).toEqual({
			user: { name: 'bob', age: '9' },
			a: ['x', 'y']
		})
	})

	it('keeps named bracket keys distinct', () => {
		const form = new FormData()
		form.append('user[name]', 'bob')
		form.append('user[email]', 'bob@x.ab')

		expect(formDataToObject(form)).toEqual({
			user: { name: 'bob', email: 'bob@x.ab' }
		})
	})

	it('coerces numeric bracket segments to array indices', () => {
		const form = new FormData()
		form.append('items[0]', 'a')
		form.append('items[1]', 'b')

		expect(formDataToObject(form)).toEqual({ items: ['a', 'b'] })
	})

	it('caps nesting depth on a pathologically deep key', () => {
		const form = new FormData()
		form.append('a' + '.b'.repeat(2000), 'x')

		const out = formDataToObject(form)

		let depth = 0
		let cur: any = out
		while (cur && typeof cur === 'object') {
			const k = Object.keys(cur)[0]
			if (k === undefined) break
			cur = cur[k]
			depth++
		}

		expect(depth).toBeLessThanOrEqual(70)
	})

	it('bounds total nested objects across many keys', () => {
		const form = new FormData()
		for (let i = 0; i < 2000; i++)
			form.append('r' + i + '.b'.repeat(62), 'x')

		const start = performance.now()
		const out = formDataToObject(form)
		const elapsed = performance.now() - start

		const countNodes = (o: any): number => {
			if (!o || typeof o !== 'object') return 0
			let n = 1
			for (const k in o) n += countNodes(o[k])
			return n
		}

		expect(countNodes(out)).toBeLessThanOrEqual(110_000)
		expect(elapsed).toBeLessThan(2_000)
	})

	it('ignores client-controlled length properties on arrays', () => {
		for (const lengthKey of ['a.length', "a['length']", 'a["length"]']) {
			const form = new FormData()
			form.append('a[0]', 'x')
			form.append(lengthKey, '4000000000')

			const start = performance.now()
			const out = formDataToObject(form)
			const elapsed = performance.now() - start

			expect(Array.isArray(out.a)).toBe(true)
			expect((out.a as unknown[]).length).toBe(1)
			expect((out.a as unknown[])[0]).toBe('x')
			expect(elapsed).toBeLessThan(1_000)
		}
	})

	it('keeps a length key when the parent is an object', () => {
		const form = new FormData()
		form.append('user.name', 'bob')
		form.append('user.length', '5')

		expect(formDataToObject(form)).toEqual({
			user: { name: 'bob', length: '5' }
		})
	})

	it('drops an out-of-range numeric array index', () => {
		const form = new FormData()
		form.append('a[0]', 'x')
		form.append('a[2000000000]', 'y')

		const start = performance.now()
		const out = formDataToObject(form)
		const elapsed = performance.now() - start

		expect(Array.isArray(out.a)).toBe(true)
		expect((out.a as unknown[]).length).toBe(1)
		expect((out.a as unknown[])[0]).toBe('x')
		expect(elapsed).toBeLessThan(1_000)
	})

	it('drops a sparse array index', () => {
		const form = new FormData()
		form.append('a[99999]', 'x')

		const start = performance.now()
		const out = formDataToObject(form)
		const elapsed = performance.now() - start

		expect(Array.isArray(out.a)).toBe(true)
		expect((out.a as unknown[]).length).toBeLessThanOrEqual(1)
		expect(elapsed).toBeLessThan(1_000)
	})

	it('drops many sparse indices without amplifying slot count', () => {
		const form = new FormData()
		for (let i = 0; i < 5_000; i++) form.append('k' + i + '[99999]', 'x')

		const start = performance.now()
		const out = formDataToObject(form)
		const elapsed = performance.now() - start

		let slots = 0
		for (const k in out)
			if (Array.isArray((out as any)[k])) slots += (out as any)[k].length
		expect(slots).toBeLessThanOrEqual(5_000)
		expect(elapsed).toBeLessThan(2_000)
	})

	it('parses contiguous and nested arrays', () => {
		const form = new FormData()
		form.append('a[0]', 'x')
		form.append('a[1]', 'y')
		form.append('b[0].name', 'bob')
		form.append('b[1].name', 'sue')
		form.append('c[0][0]', 'deep')

		expect(formDataToObject(form)).toEqual({
			a: ['x', 'y'],
			b: [{ name: 'bob' }, { name: 'sue' }],
			c: [['deep']]
		})
	})
})
