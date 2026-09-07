import { describe, expect, it } from 'bun:test'
import {
	ELYSIA_STRUCTURED_FORM,
	parseFormData
} from '../../src/parse-form-data'

describe('parseFormData', () => {
	it('export a unique symbol for the structured body alternate', () => {
		expect(typeof ELYSIA_STRUCTURED_FORM).toBe('symbol')
		expect(ELYSIA_STRUCTURED_FORM.description).toBe('ElysiaStructuredForm')
	})

	it('leave plain text fields as strings without a structured alternate', () => {
		const form = new FormData()
		form.append('name', 'Elysia')
		form.append('count', '42')

		const { body, structured } = parseFormData(form)

		expect(structured).toBeUndefined()
		expect(body).toEqual({
			name: 'Elysia',
			count: '42'
		})
	})

	it('preserve JSON object text in body and expose parsed structured alternate', () => {
		const raw = JSON.stringify({ theme: 'dark' })
		const form = new FormData()
		form.append('metadata', raw)

		const { body, structured } = parseFormData(form)

		expect(body.metadata).toBe(raw)
		expect(structured).toEqual({ metadata: { theme: 'dark' } })
	})

	it('preserve JSON array text in body and expose parsed structured alternate', () => {
		const raw = JSON.stringify([1, 2, 3])
		const form = new FormData()
		form.append('tags', raw)

		const { body, structured } = parseFormData(form)

		expect(body.tags).toBe(raw)
		expect(structured).toEqual({ tags: [1, 2, 3] })
	})

	it('keep invalid JSON-looking text as a string in both interpretations', () => {
		const raw = '{not-json'
		const form = new FormData()
		form.append('metadata', raw)

		const { body, structured } = parseFormData(form)

		expect(body.metadata).toBe(raw)
		expect(structured).toEqual({ metadata: raw })
	})

	it('assemble nested values with dot notation on both interpretations', () => {
		const raw = JSON.stringify({ nested: true })
		const form = new FormData()
		form.append('meta.info', raw)
		form.append('meta.label', 'keep')

		const { body, structured } = parseFormData(form)

		expect(body).toEqual({
			meta: {
				info: raw,
				label: 'keep'
			}
		})
		expect(structured).toEqual({
			meta: {
				info: { nested: true },
				label: 'keep'
			}
		})
	})

	it('assemble array index notation on both interpretations', () => {
		const raw = JSON.stringify({ id: '1' })
		const form = new FormData()
		form.append('items[0]', raw)
		form.append('items[1].name', 'second')

		const { body, structured } = parseFormData(form)

		expect(body.items[0]).toBe(raw)
		expect(body.items[1]).toEqual({ name: 'second' })
		expect(structured?.items[0]).toEqual({ id: '1' })
		expect(structured?.items[1]).toEqual({ name: 'second' })
	})

	it('ignore dangerous keys that would pollute the prototype', () => {
		const form = new FormData()
		form.append('user.name', 'John')
		form.append('__proto__.isAdmin', 'true')
		form.append('constructor.prototype.bad', 'true')
		form.append('user.__proto__.x', '1')

		const { body, structured } = parseFormData(form)

		expect(structured).toBeUndefined()
		expect(body).toEqual({
			user: { name: 'John' }
		})
		expect('isAdmin' in {}).toBe(false)
	})

	it('merge a single file into a JSON object sharing the same field name', () => {
		const file = new File(['hello'], 'hello.txt', { type: 'text/plain' })
		const form = new FormData()
		form.append('payload', JSON.stringify({ name: 'doc' }))
		form.append('payload', file)

		const { body, structured } = parseFormData(form)

		// Multi-value merge happens in normalizeFormValue; no single-value
		// JSON string remains, so no structured alternate is allocated
		expect(structured).toBeUndefined()
		expect(body.payload).toMatchObject({ name: 'doc' })
		expect(body.payload.file).toBeInstanceOf(File)
		expect(body.payload.file.name).toBe('hello.txt')
	})

	it('merge multiple files into files when JSON object shares the field name', () => {
		const a = new File(['a'], 'a.txt')
		const b = new File(['b'], 'b.txt')
		const form = new FormData()
		form.append('payload', JSON.stringify({ name: 'docs' }))
		form.append('payload', a)
		form.append('payload', b)

		const { body } = parseFormData(form)

		expect(body.payload).toMatchObject({ name: 'docs' })
		expect(body.payload.files).toHaveLength(2)
		expect(body.payload.files[0].name).toBe('a.txt')
		expect(body.payload.files[1].name).toBe('b.txt')
	})

	it('keep multi-value non-JSON strings as an array', () => {
		const form = new FormData()
		form.append('tags', 'a')
		form.append('tags', 'b')

		const { body, structured } = parseFormData(form)

		expect(structured).toBeUndefined()
		expect(body.tags).toEqual(['a', 'b'])
	})

	it('keep a lone File without creating a structured alternate', () => {
		const file = new File(['x'], 'x.txt')
		const form = new FormData()
		form.append('file', file)

		const { body, structured } = parseFormData(form)

		expect(structured).toBeUndefined()
		expect(body.file).toBeInstanceOf(File)
	})

	it('do not treat JSON primitive text as structured', () => {
		const form = new FormData()
		form.append('flag', 'true')
		form.append('num', '12')
		form.append('nil', 'null')

		const { body, structured } = parseFormData(form)

		expect(structured).toBeUndefined()
		expect(body).toEqual({
			flag: 'true',
			num: '12',
			nil: 'null'
		})
	})

	it('parse object string when seeding an intermediate array index', () => {
		const seed = JSON.stringify({ keep: true })
		const form = new FormData()
		// First write a JSON object string at items[0], then nest under it
		form.append('items[0]', seed)
		form.append('items[0].extra', 'value')

		const { body, structured } = parseFormData(form)

		// Intermediate JSON text at items[0] is re-parsed when nesting under it
		expect(body.items[0]).toEqual({
			keep: true,
			extra: 'value'
		})
		expect(structured?.items[0]).toEqual({
			keep: true,
			extra: 'value'
		})
	})
})
