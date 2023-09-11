import { Elysia, t } from '../src'

const app = new Elysia()
	.get('/create', ({ cookie: { name } }) => (name.value = 'Himari'))
	.get(
		'/update',
		({ cookie: { name } }) => {
			if (!name.value) throw new Error('Cookie required')

			console.log(name.value)

			name.value = 'seminar: Rio'
			console.log(name.value)

			name.value = 'seminar: Himari'
			name.value = ''

			name.maxAge = 86400
			name.add({
				domain: 'millennium.sh',
				httpOnly: true
			})

			return name.value
		},
		{
			cookie: t.Object({
				name: t.TemplateLiteral([
					t.Literal('seminar: '),
					t.Union(
						(['Rio', 'Yuuka', 'Noa', 'Koyuki'] as const).map((x) =>
							t.Literal(x)
						)
					)
				])
			})
		}
	)
	.get(
		'/council',
		({ cookie: { council } }) =>
			(council.value = [
				{
					name: 'Rin',
					affilation: 'Adminstration'
				},
				{
					name: 'Momoka',
					affilation: 'Transportation'
				}
			]),
		{
			cookie: t.Object({
				council: t.Array(
					t.Object({
						name: t.String(),
						affilation: t.String()
					})
				)
			})
		}
	)
	.get('/remove', ({ cookie }) => {
		for (const self of Object.values(cookie)) self.remove()

		return 'Deleted'
	})
	.listen(3000)

console.log(app.routes.at(-1)?.composed?.toString())

const a = <const T extends Readonly<string[]>>(a: T): T => a

a(['a', 'b'])

type Template =
	| string
	| number
	| bigint
	| boolean
	| StringConstructor
	| NumberConstructor
	| undefined

type Join<A> = A extends Readonly<[infer First, ...infer Rest]>
	? (
			First extends Readonly<Template[]>
				? First[number]
				: First extends StringConstructor
				? string
				: First extends NumberConstructor
				? `${number}`
				: First
	  ) extends infer A
		? Rest extends []
			? A extends undefined
				? NonNullable<A> | ''
				: A
			: // @ts-ignore
			A extends undefined
			? `${NonNullable<A>}${Join<Rest>}` | ''
			: // @ts-ignore
			  `${A}${Join<Rest>}`
		: ''
	: ''

const template = <
	const T extends Readonly<(Template | Readonly<Template[]>)[]>
>(
	...p: T
): Join<T> => {
	return a as any
}

const create =
	<const T extends string>(t: T): ((t: T) => void) =>
	(t) =>
		t

const optional = <
	const T extends Readonly<(Template | Readonly<Template[]>)[]>
>(
	...p: T
): T | undefined => {
	return undefined
}

template.optional = optional

const hi = create(
	template(
		['seminar', 'millennium'],
		':',
		['Rio', 'Yuuka', 'Noa', 'Koyuki'],
		template.optional(template(',', ['Rio', 'Yuuka', 'Noa', 'Koyuki'])),
		template.optional(template(',', ['Rio', 'Yuuka', 'Noa', 'Koyuki'])),
		template.optional(template(',', ['Rio', 'Yuuka', 'Noa', 'Koyuki']))
	)
)

hi(`seminar:Noa,Koyuki,Yuuka`)
