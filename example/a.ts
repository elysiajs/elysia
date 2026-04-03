import { hasType, hasTypes } from '../src/schema/utils'
import { t } from '../src/type-system'

const type = t.Form({
	a: t.Numeric(),
	b: t.Object({
		c: t.Number()
	})
})

console.log(hasType('String', type))
