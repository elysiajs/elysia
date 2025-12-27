import { describe, it } from 'bun:test'

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

			await res.exited
		},
		{
			timeout: 500
		}
	)
})
