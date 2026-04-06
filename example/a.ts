import { Compile } from 'typebox/schema'
import { t } from '../src/type'
import { run, bench, boxplot, summary } from 'mitata'
import { Errors } from 'typebox/value'

const schema = t.Object({
	hello: t.String(),
	a: t.Decode(t.String(), (value) => +value)
})

const a = Compile(schema)

bench('Compile.Errors', () => {
	a.Errors({
		hello: 'world'
	})
})

bench('Value.Errors', () => {
	Errors(a.Schema(), {
		hello: 'world'
	})
})

await run()
