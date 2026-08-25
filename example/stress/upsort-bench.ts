import Type from 'typebox'
import { Clean, Decode, Encode } from 'typebox/value'

let Settings: { Set: (o: any) => void } | undefined
try {
	Settings = require('typebox/system').Settings
} catch {}

const OFF = process.argv.includes('--off')
if (OFF) {
	if (!Settings) throw new Error('--off needs typebox >= 1.2.16')
	Settings.Set({ unionPrioritySort: false })
}

// t.Numeric
const Numeric = () =>
	Type.Union([
		Type.Number(),
		Type.Codec(
			Type.Refine(
				Type.String(),
				(v: string) => v.trim() !== '' && !isNaN(+v),
				() => 'must be number'
			)
		)
			.Decode((v) => +v)
			.Encode((v) => String(v))
	])

const schema: any = Type.Object({
	id: Numeric(),
	price: Numeric(),
	qty: Numeric(),
	rating: Numeric()
})

const N = 200_000
const decodeIn = { id: '1', price: '9.99', qty: '3', rating: '5' }
const encodeIn = { id: 1, price: 9.99, qty: 3, rating: 5 }
const cleanIn = { id: 1, price: 9.99, qty: 3, rating: 5, extra: 'drop' }

function time(label: string, fn: () => void) {
	for (let i = 0; i < 5_000; i++) fn() // warmup
	const t0 = performance.now()
	for (let i = 0; i < N; i++) fn()
	const ms = performance.now() - t0
	console.log(
		`${label.padEnd(8)} ${ms.toFixed(1).padStart(8)}ms  ${((N / ms) * 1000)
			.toFixed(0)
			.padStart(10)} ops/s`
	)
}

console.log(
	`\nmode: ${OFF ? 'unionPrioritySort OFF (shipped)' : 'baseline (implicit sort)'}  N=${N}`
)
time('decode', () => Decode(schema, decodeIn))
time('encode', () => Encode(schema, encodeIn))
time('clean', () => Clean(schema, cleanIn))
