// import { Elysia } from '../../src'
// import { describe, expect, it } from 'bun:test'

// describe('Trace AoT', async () => {
// 	it('inject request report', async () => {
// 		const app = new Elysia().trace(async () => {}).get('/', () => '')

// 		expect(app.compile().fetch.toString()).toInclude(
// 			`reporter.emit('event',{id,event:'request'`
// 		)
// 	})

// 	// ! Fix me: uncomment when 1.0.0 is released
// 	// it('inject response report', async () => {
// 	// 	const app = new Elysia().trace(async () => {}).get('/', () => '')

// 	// 	expect(app.router.history[0].composed?.toString()).toInclude(
// 	// 		`reporter.emit('event',{id,event:'response'`
// 	// 	)
// 	// })
// })
