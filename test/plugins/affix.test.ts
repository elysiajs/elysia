import { Elysia, t } from '../../src'
import { describe, it, expect } from 'bun:test'

const setup = new Elysia()
	.decorate('decorate', 'decorate')
	.state('state', 'state')
	.model('model', t.String())
	.error('error', Error)

describe('affix', () => {
	it('should add prefix to all decorators, states, models, and errors', () => {
		const app = new Elysia().use(setup).affix('prefix', 'all', 'p')

		// @ts-ignore
		expect(app.decorators).toHaveProperty('pDecorate')
		expect(app.store).toHaveProperty('pState')
		// @ts-ignore
		expect(app.definitions.type).toHaveProperty('pModel')
		// @ts-ignore
		expect(app.definitions.error).toHaveProperty('pError')
	})

	it('should add suffix to all decorators, states, models, and errors', () => {
		const app = new Elysia().use(setup).affix('suffix', 'all', 'p')

		// @ts-ignore
		expect(app.decorators).toHaveProperty('decorateP')
		// @ts-ignore
		expect(app.store).toHaveProperty('stateP')
		// @ts-ignore
		expect(app.definitions.type).toHaveProperty('modelP')
		// @ts-ignore
		expect(app.definitions.error).toHaveProperty('errorP')
	})

	it('should add suffix to all states', () => {
		const app = new Elysia().use(setup).suffix('state', 'p')

		expect(app.store).toHaveProperty('stateP')
	})

	it('should add prefix to all decorators and errors', () => {
		const app = new Elysia()
			.use(setup)
			.prefix('decorator', 'p')
			.prefix('error', 'p')

		console.log(app)

		// @ts-ignore
		expect(app.decorators).toHaveProperty('pDecorate')

		// @ts-ignore
		expect(app.definitions.error).toHaveProperty('pError')
	})

	it('should add suffix to all decorators and errors', () => {
		const app = new Elysia()
			.use(setup)
			.suffix('decorator', 'p')
			.suffix('error', 'p')

		// @ts-ignore
		expect(app.decorators).toHaveProperty('decorateP')

		// @ts-ignore
		expect(app.definitions.error).toHaveProperty('errorP')
	})

	it('should add prefix to all models', () => {
		const app = new Elysia().use(setup).prefix('model', 'p')

		// @ts-ignore
		expect(app.definitions.type).toHaveProperty('pModel')
	})

	it('should add suffix to all models', () => {
		const app = new Elysia().use(setup).affix('suffix', 'model', 'p')

		// @ts-ignore
		expect(app.definitions.type).toHaveProperty('modelP')
	})

	it('should skip on empty', () => {
		const app = new Elysia().use(setup).suffix('all', '')

		// @ts-ignore
		expect(app.decorators).toHaveProperty('decorate')
		expect(app.store).toHaveProperty('state')
		// @ts-ignore
		expect(app.definitions.type).toHaveProperty('model')
		// @ts-ignore
		expect(app.definitions.error).toHaveProperty('error')
	})
})
