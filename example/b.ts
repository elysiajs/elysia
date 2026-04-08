import { t } from '../src/type'
// import { Type as t } from 'typebox'

const stacks = <any[]>[]
Bun.gc()
const m1 = process.memoryUsage().heapUsed
const t1 = performance.now()

for (let i = 0; i <= 100_000; i++)
	stacks.push(
		t.Array(
			t.Object({
				id: t.Number(),
				name: t.String(),
				bio: t.String(),
				user: t.Object({
					name: t.String(),
					password: t.String(),
					// email: t.Optional(t.String({ format: 'email' })),
					// age: t.Optional(t.Number()),
					// avatar: t.Optional(t.String({ format: 'uri' })),
					// cover: t.Optional(t.String({ format: 'uri' }))
				}),
				// playing: t.Optional(t.String()),
				// wishlist: t.Optional(t.Array(t.Number())),
				games: t.Array(
					t.Object({
						id: t.Number(),
						// name: t.String(),
						// hoursPlay: t.Optional(t.Number({ default: 0 })),
						// tags: t.Array(
						// 	t.Object({
						// 		name: t.String(),
						// 		count: t.Number()
						// 	})
						// )
					})
				),
				// metadata: t.Intersect([
				// 	t.Object({
				// 		alias: t.String()
				// 	}),
				// 	t.Object({
				// 		country: t.Optional(t.String()),
				// 		region: t.Optional(t.String())
				// 	})
				// ]),
				// social: t.Optional(
				// 	t.Object({
				// 		facebook: t.Optional(t.String()),
				// 		twitter: t.Optional(t.String()),
				// 		youtube: t.Optional(t.String())
				// 	})
				// )
			})
		)
	)

const t2 = performance.now()
Bun.gc()
const m2 = process.memoryUsage().heapUsed

console.log('Elysia 2')
console.log('Time:', t2 - t1, 'ms')
console.log('Heap used:', (m2 - m1) / 1024 / 1024, 'MB')
