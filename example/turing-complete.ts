import { Elysia } from '../src'

type isDynamicNumber<A extends number> = number extends A ? true : false

type Plus<
	Number extends number,
	Incrementor extends number,
	iterator extends any[] = []
> = isDynamicNumber<Number> extends true
	? 0
	: Number extends iterator['length']
	? CreateArray<Incrementor> extends infer Total extends any[]
		? [...Total, ...iterator]['length']
		: never
	: Plus<Number, Incrementor, [1, ...iterator]>

type CreateArray<
	Number extends number,
	iterator extends any[] = []
> = isDynamicNumber<Number> extends true
	? []
	: Number extends iterator['length']
	? iterator
	: CreateArray<Number, [1, ...iterator]>

type GetCount<
	App extends Elysia<{
		path: ''
		error: {}
		request: {}
		store: {
			count: any
		}
		schema: {}
		meta: {
			schema: {}
			defs: {}
			exposed: {}
		}
	}>
> = App['store']['count']

const plus =
	<const Count extends number, const Current extends number>(count: Count) =>
	(
		app: Elysia<{
			path: ''
			error: {}
			request: {}
			store: {
				count: Current
			}
			schema: {}
			meta: {
				schema: {}
				defs: {}
				exposed: {}
			}
		}>
	) =>
		app.state('count', app.store.count as Plus<Current, Count>)

const app = new Elysia()
	.state('count', 0 as const)
	.use((app) => app.use(plus<5, GetCount<typeof app>>(5)))
	.use((app) => app.use(plus<2, GetCount<typeof app>>(2)))
	.use((app) => app.use(plus<1, GetCount<typeof app>>(1)))
	.use((app) =>
		// @ts-ignore: This comparison appears to be unintentional because the types '8' and '0' have no overlap.ts(2367)
		app.if((app.store.count === 0) as false, (app) =>
			app.use(plus<100, GetCount<typeof app>>(100))
		)
	)

app.store.count
