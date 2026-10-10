import { t } from '../../src'
import { describe, expect, it } from 'bun:test'

// RFC 9457 leaves every member but `type` optional on the wire, but Elysia's
// `problem()` always fills `type`, `title` and `status`, so a route declaring
// `t.Problem()` must require exactly those three — otherwise a response schema
// would reject the very body `problem()` produces
describe('TypeSystem - Problem', () => {
	it('requires only the members problemBody always fills', () => {
		expect(t.Problem().required).toEqual(['type', 'title', 'status'])
	})

	it('requires an extension member', () => {
		expect(t.Problem({ sku: t.Number() }).required).toContain('sku')
	})

	it('lets an extension member override a base member', () => {
		const schema = t.Problem({ status: t.Literal(409) })

		expect(schema.properties.status.const).toBe(409)
	})
})
