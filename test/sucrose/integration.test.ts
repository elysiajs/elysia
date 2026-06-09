import { describe, expect, it } from 'bun:test'

describe('Integration', () => {
	it(
		'Allows process to finish',
		async () => {
			const res = Bun.spawn({
				cmd: [
					'bun',
					'-e',
					"import { Elysia } from './src'; new Elysia().onBeforeHandle(() => { });"
				]
			})

			const status = await res.exited;
			expect(status).toEqual(0);
		},
		{
			timeout: 500
		}
	)
})
