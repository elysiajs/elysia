import { Elysia, t } from '../src'
import { Validator } from '../src/validator';

const a = t.Object({
	name: t.String(),
	age: t.Optional(t.Number())
})

const b = Validator.create(a)

const c = b.Check({
	name: 'a'
})

console.log(c)
