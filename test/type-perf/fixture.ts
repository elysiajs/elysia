// Keep this fixture static so type-performance counts stay comparable.
// It covers 100 schema routes, macros, plugins, and an Eden-style consumer.
import { Elysia, t } from 'elysia'

const plugin0 = new Elysia({ name: 'plugin0' })
	.decorate('dec0', 0)
	.derive(() => ({ from0: 'p0' as const }))

const plugin1 = new Elysia({ name: 'plugin1' })
	.decorate('dec1', 1)
	.derive(() => ({ from1: 'p1' as const }))

const plugin2 = new Elysia({ name: 'plugin2' })
	.decorate('dec2', 2)
	.derive(() => ({ from2: 'p2' as const }))

export const app = new Elysia()
	.use(plugin0)
	.use(plugin1)
	.use(plugin2)
	.macro({
		m0: (e: boolean) => ({ derive: () => ({ mv0: 0 }) }),
		m1: (e: boolean) => ({ derive: () => ({ mv1: 1 }) }),
		m2: (e: boolean) => ({ derive: () => ({ mv2: 2 }) }),
		m3: (e: boolean) => ({ derive: () => ({ mv3: 3 }) }),
		m4: (e: boolean) => ({ derive: () => ({ mv4: 4 }) }),
		m5: (e: boolean) => ({ derive: () => ({ mv5: 5 }) }),
		m6: (e: boolean) => ({ derive: () => ({ mv6: 6 }) }),
		m7: (e: boolean) => ({ derive: () => ({ mv7: 7 }) }),
		m8: (e: boolean) => ({ derive: () => ({ mv8: 8 }) }),
		m9: (e: boolean) => ({ derive: () => ({ mv9: 9 }) }),
		m10: (e: boolean) => ({ derive: () => ({ mv10: 10 }) }),
		m11: (e: boolean) => ({ derive: () => ({ mv11: 11 }) }),
		m12: (e: boolean) => ({ derive: () => ({ mv12: 12 }) }),
		m13: (e: boolean) => ({ derive: () => ({ mv13: 13 }) }),
		m14: (e: boolean) => ({ derive: () => ({ mv14: 14 }) }),
		m15: (e: boolean) => ({ derive: () => ({ mv15: 15 }) })
	})
	.macro({ c0: (e: boolean) => ({ derive: () => ({ cv0: 0 }) }) })
	.macro({ c1: (e: boolean) => ({ derive: () => ({ cv1: 1 }) }) })
	.macro({ c2: (e: boolean) => ({ derive: () => ({ cv2: 2 }) }) })
	.macro({ c3: (e: boolean) => ({ derive: () => ({ cv3: 3 }) }) })
	.macro({ c4: (e: boolean) => ({ derive: () => ({ cv4: 4 }) }) })
	.macro({ c5: (e: boolean) => ({ derive: () => ({ cv5: 5 }) }) })
	.macro({ c6: (e: boolean) => ({ derive: () => ({ cv6: 6 }) }) })
	.macro({ c7: (e: boolean) => ({ derive: () => ({ cv7: 7 }) }) })
	.post(
		`/r0/:id0`,
		{
			params: t.Object({ id0: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id0,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r1/:id1`,
		{
			params: t.Object({ id1: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id1,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r2/:id2`,
		{
			params: t.Object({ id2: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id2,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r3/:id3`,
		{
			params: t.Object({ id3: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id3,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r4/:id4`,
		{
			params: t.Object({ id4: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id4,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r5/:id5`,
		{
			params: t.Object({ id5: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id5,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r6/:id6`,
		{
			params: t.Object({ id6: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id6,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r7/:id7`,
		{
			params: t.Object({ id7: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id7,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r8/:id8`,
		{
			params: t.Object({ id8: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id8,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r9/:id9`,
		{
			params: t.Object({ id9: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id9,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r10/:id10`,
		{
			params: t.Object({ id10: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id10,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r11/:id11`,
		{
			params: t.Object({ id11: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id11,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r12/:id12`,
		{
			params: t.Object({ id12: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id12,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r13/:id13`,
		{
			params: t.Object({ id13: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id13,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r14/:id14`,
		{
			params: t.Object({ id14: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id14,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r15/:id15`,
		{
			params: t.Object({ id15: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id15,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r16/:id16`,
		{
			params: t.Object({ id16: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id16,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r17/:id17`,
		{
			params: t.Object({ id17: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id17,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r18/:id18`,
		{
			params: t.Object({ id18: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id18,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r19/:id19`,
		{
			params: t.Object({ id19: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id19,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r20/:id20`,
		{
			params: t.Object({ id20: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id20,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r21/:id21`,
		{
			params: t.Object({ id21: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id21,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r22/:id22`,
		{
			params: t.Object({ id22: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id22,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r23/:id23`,
		{
			params: t.Object({ id23: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id23,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r24/:id24`,
		{
			params: t.Object({ id24: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id24,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r25/:id25`,
		{
			params: t.Object({ id25: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id25,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r26/:id26`,
		{
			params: t.Object({ id26: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id26,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r27/:id27`,
		{
			params: t.Object({ id27: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id27,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r28/:id28`,
		{
			params: t.Object({ id28: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id28,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r29/:id29`,
		{
			params: t.Object({ id29: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id29,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r30/:id30`,
		{
			params: t.Object({ id30: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id30,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r31/:id31`,
		{
			params: t.Object({ id31: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id31,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r32/:id32`,
		{
			params: t.Object({ id32: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id32,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r33/:id33`,
		{
			params: t.Object({ id33: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id33,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r34/:id34`,
		{
			params: t.Object({ id34: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id34,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r35/:id35`,
		{
			params: t.Object({ id35: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id35,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r36/:id36`,
		{
			params: t.Object({ id36: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id36,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r37/:id37`,
		{
			params: t.Object({ id37: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id37,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r38/:id38`,
		{
			params: t.Object({ id38: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id38,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r39/:id39`,
		{
			params: t.Object({ id39: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id39,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r40/:id40`,
		{
			params: t.Object({ id40: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id40,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r41/:id41`,
		{
			params: t.Object({ id41: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id41,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r42/:id42`,
		{
			params: t.Object({ id42: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id42,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r43/:id43`,
		{
			params: t.Object({ id43: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id43,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r44/:id44`,
		{
			params: t.Object({ id44: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id44,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r45/:id45`,
		{
			params: t.Object({ id45: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id45,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r46/:id46`,
		{
			params: t.Object({ id46: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id46,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r47/:id47`,
		{
			params: t.Object({ id47: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id47,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r48/:id48`,
		{
			params: t.Object({ id48: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id48,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r49/:id49`,
		{
			params: t.Object({ id49: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id49,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r50/:id50`,
		{
			params: t.Object({ id50: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id50,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r51/:id51`,
		{
			params: t.Object({ id51: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id51,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r52/:id52`,
		{
			params: t.Object({ id52: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id52,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r53/:id53`,
		{
			params: t.Object({ id53: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id53,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r54/:id54`,
		{
			params: t.Object({ id54: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id54,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r55/:id55`,
		{
			params: t.Object({ id55: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id55,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r56/:id56`,
		{
			params: t.Object({ id56: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id56,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r57/:id57`,
		{
			params: t.Object({ id57: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id57,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r58/:id58`,
		{
			params: t.Object({ id58: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id58,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r59/:id59`,
		{
			params: t.Object({ id59: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id59,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r60/:id60`,
		{
			params: t.Object({ id60: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id60,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r61/:id61`,
		{
			params: t.Object({ id61: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id61,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r62/:id62`,
		{
			params: t.Object({ id62: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id62,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r63/:id63`,
		{
			params: t.Object({ id63: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id63,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r64/:id64`,
		{
			params: t.Object({ id64: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id64,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r65/:id65`,
		{
			params: t.Object({ id65: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id65,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r66/:id66`,
		{
			params: t.Object({ id66: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id66,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r67/:id67`,
		{
			params: t.Object({ id67: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id67,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r68/:id68`,
		{
			params: t.Object({ id68: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id68,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r69/:id69`,
		{
			params: t.Object({ id69: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id69,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r70/:id70`,
		{
			params: t.Object({ id70: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id70,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r71/:id71`,
		{
			params: t.Object({ id71: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id71,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r72/:id72`,
		{
			params: t.Object({ id72: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id72,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r73/:id73`,
		{
			params: t.Object({ id73: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id73,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r74/:id74`,
		{
			params: t.Object({ id74: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id74,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r75/:id75`,
		{
			params: t.Object({ id75: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id75,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r76/:id76`,
		{
			params: t.Object({ id76: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id76,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r77/:id77`,
		{
			params: t.Object({ id77: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id77,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r78/:id78`,
		{
			params: t.Object({ id78: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id78,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r79/:id79`,
		{
			params: t.Object({ id79: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id79,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r80/:id80`,
		{
			params: t.Object({ id80: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id80,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r81/:id81`,
		{
			params: t.Object({ id81: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id81,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r82/:id82`,
		{
			params: t.Object({ id82: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id82,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r83/:id83`,
		{
			params: t.Object({ id83: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id83,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r84/:id84`,
		{
			params: t.Object({ id84: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id84,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r85/:id85`,
		{
			params: t.Object({ id85: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id85,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r86/:id86`,
		{
			params: t.Object({ id86: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id86,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r87/:id87`,
		{
			params: t.Object({ id87: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id87,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r88/:id88`,
		{
			params: t.Object({ id88: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id88,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r89/:id89`,
		{
			params: t.Object({ id89: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id89,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r90/:id90`,
		{
			params: t.Object({ id90: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id90,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r91/:id91`,
		{
			params: t.Object({ id91: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id91,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r92/:id92`,
		{
			params: t.Object({ id92: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id92,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r93/:id93`,
		{
			params: t.Object({ id93: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id93,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r94/:id94`,
		{
			params: t.Object({ id94: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id94,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r95/:id95`,
		{
			params: t.Object({ id95: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id95,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r96/:id96`,
		{
			params: t.Object({ id96: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id96,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r97/:id97`,
		{
			params: t.Object({ id97: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id97,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r98/:id98`,
		{
			params: t.Object({ id98: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id98,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)
	.post(
		`/r99/:id99`,
		{
			params: t.Object({ id99: t.String() }),
			query: t.Object({ page: t.Number(), tag: t.Optional(t.String()) }),
			body: t.Object({ name: t.String(), age: t.Number() })
		},
		({ params, query, body }) => ({
			id: params.id99,
			name: body.name,
			age: body.age,
			page: query.page
		})
	)

export type App = typeof app

export type Routes = App['~Routes']
export type SampleResponse = Routes['r0'][':id0']['post']['response']

declare const consumer: Routes
export const sample = consumer.r0[':id0'].post
