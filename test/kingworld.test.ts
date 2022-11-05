import { KingWorld } from '../src'

import { describe, expect, it } from 'bun:test'

const req = (path: string) => new Request(path)

describe('KingWorld', () => {
	it('state', async () => {
		const app = new KingWorld()
			.state('a', 'a')
			.get('/', ({ store: { a } }) => a)
		const res = await app.handle(req('/'))

		expect(await res.text()).toBe('a')
	})
})
