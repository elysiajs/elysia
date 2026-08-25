import { t } from '../../src'
import { TypeBoxValidator } from '../../src/type/validator'

const schema = () =>
	t.Object({
		id: t.Numeric(),
		price: t.Numeric(),
		createdAt: t.Date(),
		active: t.BooleanString(),
		name: t.String(),
		nested: t.Object({ qty: t.Numeric() })
	})

const typeboxEncode = new TypeBoxValidator(schema()) as any
const mirrorEncode = new TypeBoxValidator(schema(), {
	slot: 'response:200' as any
}) as any

const value = () => ({
	id: 1,
	price: 9.99,
	createdAt: new Date('2020-01-01T00:00:00Z'),
	active: true,
	name: 'widget',
	nested: { qty: 3 }
})

const a = JSON.stringify(typeboxEncode.EncodeFrom(value(), 'response'))
const b = JSON.stringify(mirrorEncode.EncodeFrom(value(), 'response'))
console.log('parity:', a === b, '\n  out:', b)

const N = 200_000
function time(label: string, fn: () => void) {
	for (let i = 0; i < 5_000; i++) fn() // warmup
	const t0 = performance.now()
	for (let i = 0; i < N; i++) fn()
	const ms = performance.now() - t0
	console.log(
		`${label.padEnd(16)} ${ms.toFixed(1).padStart(8)}ms  ${((N / ms) * 1000)
			.toFixed(0)
			.padStart(10)} ops/s`
	)
}

console.log(`\nresponse EncodeFrom  N=${N}`)
time('typebox Encode', () => typeboxEncode.EncodeFrom(value(), 'response'))
time('encode mirror', () => mirrorEncode.EncodeFrom(value(), 'response'))
