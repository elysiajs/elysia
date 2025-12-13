import { t, getSchemaValidator } from '../../src'
import { expectTypeOf } from 'expect-type'

// schema validator
{
	const schema = t.Object({
		id: t.Number(),
		name: t.String()
	})

	const validator = getSchemaValidator(schema)
	const result = validator.safeParse({ id: 1, name: 'test' })

	if (result.success) {
		expectTypeOf(result.data).toEqualTypeOf<{ id: number; name: string }>()
	}
}
