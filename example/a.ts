import { Elysia } from '../src'

const db = {
	query(query: string) {
		return new Promise<unknown>((resolve) => {
			resolve('')
		})
	}
}

export const plugin = new Elysia()
	.get('', () => {
		return record('database.query', () => {
			return db.query('SELECT * FROM users')
		})
	})
