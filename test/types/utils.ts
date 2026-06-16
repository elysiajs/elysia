import { t } from '../../src'
import { Validator } from '../../src/validator'
import { expectTypeOf } from 'expect-type'

// schema validator (getSchemaValidator was renamed to Validator.create)
{
	const schema = t.Object({
		id: t.Number(),
		name: t.String()
	})

	const validator = Validator.create(schema)
	const decoded = validator.Decode({ id: 1, name: 'test' })

	expectTypeOf(decoded).toEqualTypeOf<{ id: number; name: string }>()
}
