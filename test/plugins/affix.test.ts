// @ts-nocheck
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

		expect(app.singleton.decorator).toHaveProperty('pDecorate')
		expect(app.singleton.store).toHaveProperty('pState')

		expect(app.definitions.type).toHaveProperty('pModel')

		expect(app.definitions.error).toHaveProperty('pError')
	})

	it('should add suffix to all decorators, states, models, and errors', () => {
		const app = new Elysia().use(setup).affix('suffix', 'all', 'p')

		expect(app.singleton.decorator).toHaveProperty('decorateP')

		expect(app.singleton.store).toHaveProperty('stateP')

		expect(app.definitions.type).toHaveProperty('modelP')

		expect(app.definitions.error).toHaveProperty('errorP')
	})

	it('should add suffix to all states', () => {
		const app = new Elysia().use(setup).suffix('state', 'p')

		expect(app.singleton.store).toHaveProperty('stateP')
	})

	it('should add prefix to all decorators and errors', () => {
		const app = new Elysia()
			.use(setup)
			.prefix('decorator', 'p')
			.prefix('error', 'p')

		expect(app.singleton.decorator).toHaveProperty('pDecorate')

		expect(app.definitions.error).toHaveProperty('pError')
	})

	it('should add suffix to all decorators and errors', () => {
		const app = new Elysia()
			.use(setup)
			.suffix('decorator', 'p')
			.suffix('error', 'p')

		expect(app.singleton.decorator).toHaveProperty('decorateP')

		expect(app.definitions.error).toHaveProperty('errorP')
	})

	it('should add prefix to all models', () => {
		const app = new Elysia().use(setup).prefix('model', 'p')

		expect(app.definitions.type).toHaveProperty('pModel')
	})

	it('should add suffix to all models', () => {
		const app = new Elysia().use(setup).affix('suffix', 'model', 'p')

		expect(app.definitions.type).toHaveProperty('modelP')
	})

	it('should skip on empty', () => {
		const app = new Elysia().use(setup).suffix('all', '')

		expect(app.singleton.decorator).toHaveProperty('decorate')
		expect(app.singleton.store).toHaveProperty('state')

		expect(app.definitions.type).toHaveProperty('model')

		expect(app.definitions.error).toHaveProperty('error')
	})
})
