import { Elysia } from '../src'

const app = new Elysia().get(
			'/bad',
			{ headers: { 'x-a': '1' } },
			'hello' as any
		)
