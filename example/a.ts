import { Elysia, problem, HTTPError, t } from '../src'

const plugin = new Elysia({ name: 'final' })
	.macro({
		objForm: {
			// object-form macro + derive
			derive: () => ({ iris: { publish: (v: unknown) => String(v) } })
		},
		fnForm(value: boolean | undefined) {
			// function-form macro + derive
			if (!value) return {}

			return {
				derive: () => ({ iris: { publish: (v: unknown) => String(v) } })
			}
		}
	})
	.derive('global', () => ({ iris: { touch: (route: string) => '...' } }))

new Elysia().use(plugin).get('/fn', { fnForm: true }, ({ iris }) => {
	// iris is any?
	iris.publish('x')
	iris.touch('/a')

	// this should error
	iris.definitelyNotAThing()

	return 'ok'
})
