import isEvenCore from 'is-even'

type NumberUnit = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'

type GetLast<T extends string> = T extends `${infer Unit}${infer Rest}`
	? Unit extends '-'
		? GetLast<Rest>
		: Rest extends `,${infer Rest}`
		? GetLast<Rest>
		: Rest extends `.${string}`
		? GetLast<Unit>
		: Unit extends NumberUnit
		? Rest extends ''
			? Unit
			: GetLast<Rest>
		: GetLast<Rest>
	: never

type IsEven<T extends string | number> = GetLast<`${T}`> extends infer Last
	? Last extends '0' | '2' | '4' | '6' | '8'
		? true
		: false
	: false

const isEven = <const T extends string | number>(value: T) =>
	isEvenCore(value) as IsEven<T>

const a1 = isEven(-200) // ? true
const a2 = isEven('617') // ? false
const a3 = isEven('-2,300.1') // ? true
