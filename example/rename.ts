import { Elysia, t } from '../src'

// ? Elysia#83 | Proposal: Standardized way of renaming third party plugin-scoped stuff
// this would be a plugin provided by a third party
const myPlugin = new Elysia()
	.decorate('myProperty', 42)
	.model('salt', t.String())

new Elysia()
	.use(
		myPlugin
			// map decorator, rename "myProperty" to "renamedProperty"
			.decorate(({ myProperty, ...decorators }) => ({
				renamedProperty: myProperty,
				...decorators
			}))
			// map model, rename "salt" to "pepper"
			.model(({ salt, ...models }) => ({
				...models,
				pepper: t.String()
			}))
			// Add prefix
			.prefix('decorator', 'unstable')
	)
	.get(
		'/mapped',
		({ unstableRenamedProperty }) => unstableRenamedProperty
	)
	.post('/pepper', ({ body }) => body, {
		body: 'pepper',
		// response: t.String()
	})
