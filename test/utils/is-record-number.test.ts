import { describe, expect, it } from 'bun:test'
import { isRecordNumber } from '../../src/utils'
import { t } from '../../src'
import { Elysia } from '../../src'

describe('isRecordNumber', () => {
	it('returns false for an empty object', () => {
		expect(isRecordNumber({})).toBe(false)
	})

	it('returns false for undefined', () => {
		expect(isRecordNumber(undefined)).toBe(false)
	})

	it('returns true for a proper numeric status map', () => {
		expect(isRecordNumber({ 200: 'ok', 400: 'bad' })).toBe(true)
		expect(isRecordNumber({ 200: t.String() })).toBe(true)
	})

	it('returns false for an object with non-numeric keys', () => {
		expect(isRecordNumber({ type: 'string' })).toBe(false)
		expect(isRecordNumber({ a: 1, b: 2 })).toBe(false)
	})

	it('returns false for a mixed numeric/string key object', () => {
		expect(isRecordNumber({ 200: 'ok', name: 'bad' })).toBe(false)
	})

	it('route with t.Any() response is introspected as { 200: schema }', () => {
		const app = new Elysia().get(
			'/any',
			{ response: t.Any() },
			() => 'anything'
		)

		const [route] = app.routes
		const response = route.hooks.response as Record<number, unknown>
		expect(typeof response).toBe('object')
		expect(Object.keys(response)).toEqual(['200'])
	})

	it('route with t.Object() as single schema is wrapped as { 200: schema }', () => {
		const app = new Elysia().get(
			'/obj',
			{ response: t.Object({ name: t.String() }) },
			() => ({ name: 'Elysia' })
		)

		const [route] = app.routes
		const response = route.hooks.response as Record<number, unknown>
		expect(Object.keys(response)).toEqual(['200'])
	})

	it('route with explicit status map is not re-wrapped', () => {
		const app = new Elysia().get(
			'/explicit',
			{ response: { 200: t.String(), 404: t.String() } },
			() => 'ok'
		)

		const [route] = app.routes
		const response = route.hooks.response as Record<number, unknown>
		const keys = Object.keys(response).sort()
		expect(keys).toEqual(['200', '404'])
	})
})
