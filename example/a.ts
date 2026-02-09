import { Elysia } from '../src'
import { req } from '../test/utils'

import { SQL } from 'bun'

const sql = new SQL(':memory:')

await sql`CREATE TABLE elysia_repro_users (id SERIAL PRIMARY KEY, name TEXT)`
const { count } =
	await sql`SELECT COUNT(*) as count FROM elysia_repro_users`.then(
		(x) => x[0]
	)

if (!count)
	await sql`INSERT INTO elysia_repro_users (name) VALUES ('Alice'), ('Bob')`

const app = new Elysia().get('/', () => sql`SELECT * FROM elysia_repro_users`)

app.handle(req('/'))
	.then((x) => x.json())
	.then(console.log)
