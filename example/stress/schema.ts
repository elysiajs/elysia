import { t } from '../../src/type'
// import { Type as t } from 'typebox'

import { profile } from './utils'

const total = 100_000
const stacks = <any[]>Array(total)

const build = () => t.String()

// warm builder/lazy-init paths and sweep so the profile window measures
// construction, not cold-heap growth hysteresis
for (let i = 0; i < 100; i++) build()
Bun.gc(true)

const stop = profile('Elysia 2 schema with 45 types x100,000')

for (let i = 0; i < total; i++) stacks[i] = build()

stop()

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
