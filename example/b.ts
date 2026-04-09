import { applyCoercions } from '../src/schema/coerce'
import { t } from '../src/type'
// import { Type as t } from 'typebox'
// import { Type as t } from '@sinclair/typebox'

function gc() {
	if (typeof Bun !== 'undefined') Bun.gc(true)
	else if (typeof global.gc === 'function') global.gc()
}

function memoryUsage() {
	if (typeof Bun !== 'undefined') {
		const { memoryUsage } = require('bun:jsc')

		gc()
		return memoryUsage().current
	}

	gc()
	return process.memoryUsage().heapUsed
}

const total = 100_000
const stacks = <any[]>Array(total)
const m1 = memoryUsage()
const t1 = performance.now()

// const coerce = (schema: any) =>
// 	applyCoercions(schema, [
// 		[
// 			[
// 				['Number', (x) => t.Numeric(x)],
// 				['Boolean', (x) => t.BooleanString(x)]
// 			]
// 		]
// 	])

for (let i = 0; i <= 100_000; i++)
	stacks[i] =
		// coerce(
		t.Array(
			t.Object({
				id: t.Number(),
				name: t.String(),
				bio: t.String(),
				user: t.Object({
					name: t.String(),
					password: t.String(),
					email: t.Optional(t.String({ format: 'email' })),
					age: t.Optional(t.Number()),
					avatar: t.Optional(t.String({ format: 'uri' })),
					cover: t.Optional(t.String({ format: 'uri' }))
				}),
				playing: t.Optional(t.String()),
				wishlist: t.Optional(t.Array(t.Number())),
				games: t.Array(
					t.Object({
						id: t.Number(),
						name: t.String(),
						hoursPlay: t.Number(),
						tags: t.Array(
							t.Object({
								name: t.String(),
								count: t.Number()
							})
						)
					})
				),
				metadata: t.Intersect([
					t.Object({
						alias: t.String()
					}),
					t.Object({
						country: t.Optional(t.String()),
						region: t.Optional(t.String())
					})
				]),
				social: t.Optional(
					t.Object({
						facebook: t.Optional(t.String()),
						twitter: t.Optional(t.String()),
						youtube: t.Optional(t.String())
					})
				)
			})
		)
// )

const t2 = performance.now()
gc()
const m2 = memoryUsage()

console.log('Elysia 2')
console.log('Time:', (t2 - t1).toFixed(2), 'ms')
console.log('Memory usage:', ((m2 - m1) / 1024 / 1024).toFixed(2), 'MB')

// console.dir(stacks[0], {
// 	depth: null
// })

// import { Compile } from 'typebox/schema'

// const comp = Compile(stacks[0])

// console.log(
// 	comp.Check([
// 		{
// 			id: 1,
// 			name: 'SaltyAom',
// 			bio: 'I like train',
// 			user: {
// 				name: 'SaltyAom',
// 				password: '123456',
// 				avatar: 'https://avatars.githubusercontent.com/u/35027979?v=4',
// 				cover: 'https://saltyaom.com/cosplay/pekomama.webp'
// 			},
// 			playing: 'Strinova',
// 			wishlist: [4_154_456, 2_345_345],
// 			games: [
// 				{
// 					id: 4_154_456,
// 					name: 'MiSide',
// 					hoursPlay: 17,
// 					tags: [
// 						{ name: 'Psychological Horror', count: 236_432 },
// 						{ name: 'Cute', count: 495_439 },
// 						{ name: 'Dating Sim', count: 395_532 }
// 					]
// 				},
// 				{
// 					id: 4_356_345,
// 					name: 'Strinova',
// 					hoursPlay: 365,
// 					tags: [
// 						{ name: 'Free to Play', count: 205_593 },
// 						{ name: 'Anime', count: 504_304 },
// 						{ name: 'Third-Person Shooter', count: 395_532 }
// 					]
// 				},
// 				{
// 					id: 2_345_345,
// 					name: "Tom Clancy's Rainbow Six Siege",
// 					hoursPlay: 287,
// 					tags: [
// 						{ name: 'FPS', count: 855_324 },
// 						{ name: 'Multiplayer', count: 456_567 },
// 						{ name: 'Tactical', count: 544_467 }
// 					]
// 				}
// 			],
// 			metadata: {
// 				alias: 'SaltyAom',
// 				country: 'Thailand',
// 				region: 'Asia'
// 			},
// 			social: {
// 				twitter: 'SaltyAom'
// 			}
// 		},
// 		{
// 			id: 2,
// 			name: 'VLost',
// 			bio: 'ไม่พี่คืองี้',
// 			user: {
// 				name: 'nattapon_kub',
// 				password: '123456'
// 			},
// 			games: [
// 				{
// 					id: 4_154_456,
// 					name: 'MiSide',
// 					hoursPlay: 17,
// 					tags: [
// 						{ name: 'Psychological Horror', count: 236_432 },
// 						{ name: 'Cute', count: 495_439 },
// 						{ name: 'Dating Sim', count: 395_532 }
// 					]
// 				},
// 				{
// 					id: 4_356_345,
// 					name: 'Strinova',
// 					hoursPlay: 365,
// 					tags: [
// 						{ name: 'Free to Play', count: 205_593 },
// 						{ name: 'Anime', count: 504_304 },
// 						{ name: 'Third-Person Shooter', count: 395_532 }
// 					]
// 				}
// 			],
// 			metadata: {
// 				alias: 'vlost',
// 				country: 'Thailand'
// 			}
// 		},
// 		{
// 			id: 2,
// 			name: 'eika',
// 			bio: 'こんにちわ！',
// 			user: {
// 				name: 'ei_ka',
// 				password: '123456'
// 			},
// 			games: [
// 				{
// 					id: 4_356_345,
// 					name: 'Strinova',
// 					hoursPlay: 365,
// 					tags: [
// 						{ name: 'Free to Play', count: 205_593 },
// 						{ name: 'Anime', count: 504_304 },
// 						{ name: 'Third-Person Shooter', count: 395_532 }
// 					]
// 				}
// 			],
// 			metadata: {
// 				alias: 'eika',
// 				country: 'Japan'
// 			}
// 		}
// 	])
// )
