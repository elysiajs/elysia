import { expectTypeOf } from 'expect-type'
import { Elysia } from '../../src'

// ? async plugin should mark as partial
{
	const serviceA = async () => {
		await Bun.sleep(1)

		return new Elysia()
			.decorate('decoratorA', 'decoratorA')
			.state('storeA', 'storeA' as const)
			.derive(() => ({
				deriveA: 'deriveA'
			}))
			.resolve(() => ({
				resolveA: 'resolveA'
			}))
	}

	new Elysia()
		.use(serviceA)
		.decorate((v) => {
			expectTypeOf(v.decoratorA).toEqualTypeOf<string | undefined>()

			return v
		})
		.state((v) => {
			expectTypeOf(v.storeA).toEqualTypeOf<'storeA' | undefined>()

			return v
		})
		.derive((v) => {
			expectTypeOf(v.deriveA).toEqualTypeOf<'deriveA' | undefined>()

			return v
		})
		.resolve((v) => {
			expectTypeOf(v.resolveA).toEqualTypeOf<'resolveA' | undefined>()

			return v
		})
}

// ? inline async should mark plugin as partial
{
	const serviceA = new Elysia().use(async (app) => {
		await Bun.sleep(1)

		return app
			.decorate('decoratorA', 'decoratorA')
			.state('storeA', 'storeA' as const)
			.derive(() => ({
				deriveA: 'deriveA'
			}))
			.resolve(() => ({
				resolveA: 'resolveA'
			}))
			.as('scoped')
	})

	new Elysia()
		.use(serviceA)
		.decorate((v) => {
			expectTypeOf(v.decoratorA).toEqualTypeOf<string | undefined>()

			return v
		})
		.state((v) => {
			expectTypeOf(v.storeA).toEqualTypeOf<'storeA' | undefined>()

			return v
		})
		.derive((v) => {
			expectTypeOf(v.deriveA).toEqualTypeOf<'deriveA' | undefined>()

			return v
		})
		.resolve((v) => {
			expectTypeOf(v.resolveA).toEqualTypeOf<'resolveA' | undefined>()

			return v
		})
}

// ? async plugin should mark plugin as partial
{
	const serviceA = async () => {
		await Bun.sleep(1)

		return new Elysia()
			.decorate('decoratorA', 'decoratorA')
			.state('storeA', 'storeA' as const)
			.derive(() => ({
				deriveA: 'deriveA'
			}))
			.resolve(() => ({
				resolveA: 'resolveA'
			}))
			.as('scoped')
	}

	new Elysia()
		.use(serviceA)
		.decorate((v) => {
			expectTypeOf(v.decoratorA).toEqualTypeOf<string | undefined>()

			return v
		})
		.state((v) => {
			expectTypeOf(v.storeA).toEqualTypeOf<'storeA' | undefined>()

			return v
		})
		.derive((v) => {
			expectTypeOf(v.deriveA).toEqualTypeOf<'deriveA' | undefined>()

			return v
		})
		.resolve((v) => {
			expectTypeOf(v.resolveA).toEqualTypeOf<'resolveA' | undefined>()

			return v
		})
}

// ? inline async should mark plugin as partial
{
	const serviceA = new Elysia().use(async (app) => {
		await Bun.sleep(1)

		return app
			.decorate('decoratorA', 'decoratorA')
			.state('storeA', 'storeA' as const)
			.derive(() => ({
				deriveA: 'deriveA'
			}))
			.resolve(() => ({
				resolveA: 'resolveA'
			}))
			.as('scoped')
	})

	new Elysia()
		.use(serviceA)
		.decorate((v) => {
			expectTypeOf(v.decoratorA).toEqualTypeOf<string | undefined>()

			return v
		})
		.state((v) => {
			expectTypeOf(v.storeA).toEqualTypeOf<'storeA' | undefined>()

			return v
		})
		.derive((v) => {
			expectTypeOf(v.deriveA).toEqualTypeOf<'deriveA' | undefined>()

			return v
		})
		.resolve((v) => {
			expectTypeOf(v.resolveA).toEqualTypeOf<'resolveA' | undefined>()

			return v
		})
}

// ? async plugin should mark global as partial
{
	const serviceA = async () => {
		await Bun.sleep(1)

		return new Elysia()
			.decorate('decoratorA', 'decoratorA')
			.state('storeA', 'storeA' as const)
			.derive(() => ({
				deriveA: 'deriveA'
			}))
			.resolve(() => ({
				resolveA: 'resolveA'
			}))
			.as('global')
	}

	new Elysia()
		.use(serviceA)
		.decorate((v) => {
			expectTypeOf(v.decoratorA).toEqualTypeOf<string | undefined>()

			return v
		})
		.state((v) => {
			expectTypeOf(v.storeA).toEqualTypeOf<'storeA' | undefined>()

			return v
		})
		.derive((v) => {
			expectTypeOf(v.deriveA).toEqualTypeOf<'deriveA' | undefined>()

			return v
		})
		.resolve((v) => {
			expectTypeOf(v.resolveA).toEqualTypeOf<'resolveA' | undefined>()

			return v
		})
}

// ? inline async should mark global as partial
{
	const serviceA = new Elysia().use(async (app) => {
		await Bun.sleep(1)

		return app
			.decorate('decoratorA', 'decoratorA')
			.state('storeA', 'storeA' as const)
			.derive(() => ({
				deriveA: 'deriveA'
			}))
			.resolve(() => ({
				resolveA: 'resolveA'
			}))
			.as('global')
	})

	new Elysia()
		.use(serviceA)
		.decorate((v) => {
			expectTypeOf(v.decoratorA).toEqualTypeOf<string | undefined>()

			return v
		})
		.state((v) => {
			expectTypeOf(v.storeA).toEqualTypeOf<'storeA' | undefined>()

			return v
		})
		.derive((v) => {
			expectTypeOf(v.deriveA).toEqualTypeOf<'deriveA' | undefined>()

			return v
		})
		.resolve((v) => {
			expectTypeOf(v.resolveA).toEqualTypeOf<'resolveA' | undefined>()

			return v
		})
}

{
	// ? inherits lazy loading plugin type
	new Elysia().use(import('./plugins')).get(
		'/',
		({ body, decorate, store: { state } }) => {
			expectTypeOf<typeof decorate>().toBeString()
			expectTypeOf<typeof state>().toBeString()
			expectTypeOf<typeof body>().toBeString()
		},
		{
			body: 'string'
		}
	)
}
