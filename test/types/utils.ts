import { t } from '../../src'
import { Validator } from '../../src/validator'
import { expectTypeOf } from 'expect-type'

// Schema validators preserve their decoded type.
{
	const schema = t.Object({
		id: t.Number(),
		name: t.String()
	})

	const validator = Validator.create(schema)
	const decoded = validator.Decode({ id: 1, name: 'test' })

	expectTypeOf(decoded).toEqualTypeOf<{ id: number; name: string }>()
}
