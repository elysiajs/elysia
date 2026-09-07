import { expectTypeOf } from 'expect-type'
import { Elysia } from '../../src'

// Async plugin-derived values are optional; decorations and state remain exact.
{
	const serviceA = async () => {
		await Bun.sleep(1)

		return new Elysia()
			.decorate('decoratorA', 'decoratorA')
			.state('storeA', 'storeA' as const)
			.derive(() => ({
				deriveA: 'deriveA'
			}))
			.derive(() => ({
				resolveA: 'resolveA'
			}))
	}

	new Elysia()
		.use(serviceA)
		.decorate((v) => {
			expectTypeOf(v.decoratorA).toEqualTypeOf<string>()

			return v
		})
		.state((v) => {
			expectTypeOf(v.storeA).toEqualTypeOf<'storeA'>()

			return v
		})
		.derive((v) => {
			expectTypeOf(v.deriveA).toEqualTypeOf<'deriveA' | undefined>()

			return v
		})
		.derive((v) => {
			expectTypeOf(v.resolveA).toEqualTypeOf<'resolveA' | undefined>()

			return v
		})
}

// Inline plugin-scoped async derivations are optional; decorations and state remain exact.
{
	const serviceA = new Elysia().use(async (app) => {
		await Bun.sleep(1)

		return app
			.decorate('decoratorA', 'decoratorA')
			.state('storeA', 'storeA' as const)
			.derive(() => ({
				deriveA: 'deriveA'
			}))
			.derive(() => ({
				resolveA: 'resolveA'
			}))
			.as('plugin')
	})

	new Elysia()
		.use(serviceA)
		.decorate((v) => {
			expectTypeOf(v.decoratorA).toEqualTypeOf<string>()

			return v
		})
		.state((v) => {
			expectTypeOf(v.storeA).toEqualTypeOf<'storeA'>()

			return v
		})
		.derive((v) => {
			expectTypeOf(v.deriveA).toEqualTypeOf<'deriveA' | undefined>()

			return v
		})
		.derive((v) => {
			expectTypeOf(v.resolveA).toEqualTypeOf<'resolveA' | undefined>()

			return v
		})
}

// Plugin-scoped async derivations are optional; decorations and state remain exact.
{
	const serviceA = async () => {
		await Bun.sleep(1)

		return new Elysia()
			.decorate('decoratorA', 'decoratorA')
			.state('storeA', 'storeA' as const)
			.derive(() => ({
				deriveA: 'deriveA'
			}))
			.derive(() => ({
				resolveA: 'resolveA'
			}))
			.as('plugin')
	}

	new Elysia()
		.use(serviceA)
		.decorate((v) => {
			expectTypeOf(v.decoratorA).toEqualTypeOf<string>()

			return v
		})
		.state((v) => {
			expectTypeOf(v.storeA).toEqualTypeOf<'storeA'>()

			return v
		})
		.derive((v) => {
			expectTypeOf(v.deriveA).toEqualTypeOf<'deriveA' | undefined>()

			return v
		})
		.derive((v) => {
			expectTypeOf(v.resolveA).toEqualTypeOf<'resolveA' | undefined>()

			return v
		})
}

// Inline plugin-scoped async derivations are optional; decorations and state remain exact.
{
	const serviceA = new Elysia().use(async (app) => {
		await Bun.sleep(1)

		return app
			.decorate('decoratorA', 'decoratorA')
			.state('storeA', 'storeA' as const)
			.derive(() => ({
				deriveA: 'deriveA'
			}))
			.derive(() => ({
				resolveA: 'resolveA'
			}))
			.as('plugin')
	})

	new Elysia()
		.use(serviceA)
		.decorate((v) => {
			expectTypeOf(v.decoratorA).toEqualTypeOf<string>()

			return v
		})
		.state((v) => {
			expectTypeOf(v.storeA).toEqualTypeOf<'storeA'>()

			return v
		})
		.derive((v) => {
			expectTypeOf(v.deriveA).toEqualTypeOf<'deriveA' | undefined>()

			return v
		})
		.derive((v) => {
			expectTypeOf(v.resolveA).toEqualTypeOf<'resolveA' | undefined>()

			return v
		})
}

// Global async derivations are optional; decorations and state remain exact.
{
	const serviceA = async () => {
		await Bun.sleep(1)

		return new Elysia()
			.decorate('decoratorA', 'decoratorA')
			.state('storeA', 'storeA' as const)
			.derive(() => ({
				deriveA: 'deriveA'
			}))
			.derive(() => ({
				resolveA: 'resolveA'
			}))
			.as('global')
	}

	new Elysia()
		.use(serviceA)
		.decorate((v) => {
			expectTypeOf(v.decoratorA).toEqualTypeOf<string>()

			return v
		})
		.state((v) => {
			expectTypeOf(v.storeA).toEqualTypeOf<'storeA'>()

			return v
		})
		.derive((v) => {
			expectTypeOf(v.deriveA).toEqualTypeOf<'deriveA' | undefined>()

			return v
		})
		.derive((v) => {
			expectTypeOf(v.resolveA).toEqualTypeOf<'resolveA' | undefined>()

			return v
		})
}

// Inline global async derivations are optional; decorations and state remain exact.
{
	const serviceA = new Elysia().use(async (app) => {
		await Bun.sleep(1)

		return app
			.decorate('decoratorA', 'decoratorA')
			.state('storeA', 'storeA' as const)
			.derive(() => ({
				deriveA: 'deriveA'
			}))
			.derive(() => ({
				resolveA: 'resolveA'
			}))
			.as('global')
	})

	new Elysia()
		.use(serviceA)
		.decorate((v) => {
			expectTypeOf(v.decoratorA).toEqualTypeOf<string>()

			return v
		})
		.state((v) => {
			expectTypeOf(v.storeA).toEqualTypeOf<'storeA'>()

			return v
		})
		.derive((v) => {
			expectTypeOf(v.deriveA).toEqualTypeOf<'deriveA' | undefined>()

			return v
		})
		.derive((v) => {
			expectTypeOf(v.resolveA).toEqualTypeOf<'resolveA' | undefined>()

			return v
		})
}

{
	// ? inherits lazy loading plugin type
	new Elysia().use(import('./plugins')).get(
		'/',
		{
			body: 'string'
		},
		({ body, decorate, store: { state } }) => {
			expectTypeOf<typeof decorate>().toBeString()
			expectTypeOf<typeof state>().toBeString()
			expectTypeOf<typeof body>().toBeString()
		}
	)
}
