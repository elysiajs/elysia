import { SQL } from 'bun'
import { describe, it, expect } from 'bun:test'

import Elysia from '../../src'
import { req } from '../utils'

describe('Bun.SQL', () => {
	it('serialize custom array-like custom class with array sub class', async () => {
		const sql = new SQL(':memory:')

		await sql`CREATE TABLE elysia_repro_users (id SERIAL PRIMARY KEY, name TEXT)`
		const { count } =
			await sql`SELECT COUNT(*) as count FROM elysia_repro_users`.then(
				(x) => x[0]
			)

		if (!count)
			await sql`INSERT INTO elysia_repro_users (name) VALUES ('Alice'), ('Bob')`

		const app = new Elysia().get(
			'/',
			() => sql`SELECT * FROM elysia_repro_users`
		)

		const value = await app.handle(req('/')).then((x) => x.json())

		expect(value).toEqual([
			{
				id: null,
				name: 'Alice'
			},
			{
				id: null,
				name: 'Bob'
			}
		])
	})
})
