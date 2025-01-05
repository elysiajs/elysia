import { Elysia } from '../../src'
import { expectTypeOf } from 'expect-type'

// guard handle resolve macro
{
	const plugin = new Elysia()
		.macro({
			account: (a: boolean) => ({
				resolve: ({ error }) => ({
					account: 'A'
				})
			})
		})
		.guard({
			account: true
		})
		.get('/', ({ account }) => {
			expectTypeOf(account).toEqualTypeOf<string>()
		})

	const parent = new Elysia().use(plugin).get('/', (context) => {
		expectTypeOf(context).not.toHaveProperty('account')
	})

	const app = new Elysia().use(parent).get('/', (context) => {
		expectTypeOf(context).not.toHaveProperty('account')
	})
}

// guard handle resolve macro with scoped
{
	const plugin = new Elysia()
		.macro({
			account: (a: boolean) => ({
				resolve: ({ error }) => ({
					account: 'A'
				})
			})
		})
		.guard({
			as: 'scoped',
			account: true
		})
		.get('/', ({ account }) => {
			expectTypeOf(account).toEqualTypeOf<string>()
		})

	const parent = new Elysia().use(plugin).get('/', (context) => {
		expectTypeOf(context).toHaveProperty('account')
		expectTypeOf(context.account).toEqualTypeOf<string>()
	})

	const app = new Elysia().use(parent).get('/', (context) => {
		expectTypeOf(context).not.toHaveProperty('account')
	})
}

// guard handle resolve macro with global
{
	const plugin = new Elysia()
		.macro({
			account: (a: boolean) => ({
				resolve: ({ error }) => ({
					account: 'A'
				})
			})
		})
		.guard({
			as: 'global',
			account: true
		})
		.get('/', ({ account }) => {
			expectTypeOf(account).toEqualTypeOf<string>()
		})

	const parent = new Elysia().use(plugin).get('/', (context) => {
		expectTypeOf(context).toHaveProperty('account')
		expectTypeOf(context.account).toEqualTypeOf<string>()
	})

	const app = new Elysia().use(parent).get('/', (context) => {
		expectTypeOf(context).toHaveProperty('account')
		expectTypeOf(context.account).toEqualTypeOf<string>()
	})
}

// guard handle resolve macro with local
{
	const plugin = new Elysia()
		.macro({
			account: (a: boolean) => ({
				resolve: ({ error }) => ({
					account: 'A'
				})
			})
		})
		.guard({
			as: 'local',
			account: true
		})
		.get('/', ({ account }) => {
			expectTypeOf(account).toEqualTypeOf<string>()
		})

	const parent = new Elysia().use(plugin).get('/', (context) => {
		expectTypeOf(context).not.toHaveProperty('account')
	})

	const app = new Elysia().use(parent).get('/', (context) => {
		expectTypeOf(context).not.toHaveProperty('account')
	})
}

// guard handle resolve macro with error
{
	const plugin = new Elysia()
		.macro({
			account: (a: boolean) => ({
				resolve: ({ error }) => {
					if (Math.random() > 0.5) return error(401)

					return {
						account: 'A'
					}
				}
			})
		})
		.guard({
			account: true
		})
		.get('/', ({ account }) => {
			expectTypeOf(account).toEqualTypeOf<string>()
		})

	const parent = new Elysia().use(plugin).get('/', (context) => {
		expectTypeOf(context).not.toHaveProperty('account')
	})

	const app = new Elysia().use(parent).get('/', (context) => {
		expectTypeOf(context).not.toHaveProperty('account')
	})
}

// guard handle resolve macro with async
{
	const plugin = new Elysia()
		.macro({
			account: (a: boolean) => ({
				resolve: async ({ error }) => {
					if (Math.random() > 0.5) return error(401)

					return {
						account: 'A'
					}
				}
			})
		})
		.guard({
			as: 'scoped',
			account: true
		})
		.get('/', ({ account }) => {
			expectTypeOf(account).toEqualTypeOf<string>()
		})

	const parent = new Elysia().use(plugin).get('/', (context) => {
		expectTypeOf(context).toHaveProperty('account')
		expectTypeOf(context.account).toEqualTypeOf<string>()
	})

	const app = new Elysia().use(parent).get('/', (context) => {
		expectTypeOf(context).not.toHaveProperty('account')
	})
}

// Handle ephemeral and volatile property
{
	const app = new Elysia()
		.resolve(() => {
			return {
				hello: 'world'
			}
		})
		.macro({
			user: (enabled: boolean) => ({
				resolve: ({ hello, query: { name = 'anon' } }) => {
					expectTypeOf(hello).toEqualTypeOf<'world' | undefined>()

					return {
						user: {
							name
						}
					}
				}
			})
		})
		.get('/', ({ user }) => user, {
			user: true
		})
}

// Handle shorthand function macro
{
	const app = new Elysia()
		.macro({
			user: {
				resolve: ({ query: { name = 'anon' } }) => ({
					user: {
						name
					}
				})
			}
		})
		.get(
			'/',
			({ user }) => {
				expectTypeOf(user).toEqualTypeOf<{ name: string }>()
			},
			{
				user: true
			}
		)
		.get(
			'/no',
			(context) => {
				expectTypeOf(context).not.toHaveProperty('user')
			},
			{
				user: false
			}
		)
}
