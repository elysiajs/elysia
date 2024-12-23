import { describe, expect, it } from 'bun:test'
import { Elysia } from '../../src'
import { req } from '../utils'

describe('Error correctly passed to outer elysia instance', () => {
	it('Global error handler is run', async () => {
		let globalHandlerRun = false

		const mainApp = new Elysia().onError(() => {
			globalHandlerRun = true
			return 'Fail'
		})

		const plugin = new Elysia().get('/foo', () => {
			throw new Error('Error')
		})

		mainApp.use(plugin)

		const res = await (await mainApp.handle(req('/foo'))).text()

		expect(res).toBe('Fail')
		expect(globalHandlerRun).toBeTrue()
	})

	it('Plugin global handler is executed before plugin handler', async () => {
		//I would expect the plugin error handler to be executed
		let globalHandlerRun = false
		let localHandlerRun = false

		const plugin = new Elysia({
			prefix: '/a'
		})
			.onError({ as: 'global' }, () => {
				localHandlerRun = true
				return 'FailPlugin'
			})
			.get('/foo', () => {
				throw new Error('Error')
			})

		const mainApp = new Elysia()
			.onError(() => {
				globalHandlerRun = true

				return 'Fail'
			})
			.use(plugin)

		const res = await mainApp.handle(req('/a/foo')).then((x) => x.text())

		expect(res).toBe('Fail')
		expect(localHandlerRun).toBeFalse()
		expect(globalHandlerRun).toBeTrue()
	})
})
