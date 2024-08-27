import { Elysia, t } from '../src'
import { classToObject } from '../src/utils'
import { req } from '../test/utils'

const app = new Elysia({
	normalize: true
})
	.get(
		'/',
		() => {
			class MyTest {
				constructor(hello: string) {
					this.one = hello
					this.two = hello
				}
				public one: string
				public two: string

				get oneGet() {
					return this.one
				}

				get twoGet() {
					return this.two
				}
			}

			class MyTest2 {
				constructor(hello: string) {
					this.one = hello
					this.two = hello
					this.three = [new MyTest(hello)]
					this.four = [new MyTest(hello)]
				}

				public one: string
				public two: string
				public three: MyTest[]
				public four: MyTest[]

				get oneGet() {
					return this.one
				}

				get twoGet() {
					return this.two
				}

				get threeGet() {
					return this.three
				}

				get fourGet() {
					return this.four
				}
			}

			const res = new MyTest2('world')

			return [res]
		},
		{
			response: t.Array(
				t.Object(
					{
						one: t.String(),
						oneGet: t.String(),
						three: t.Array(
							t.Object(
								{
									one: t.String(),
									oneGet: t.String()
								},
								{ additionalProperties: false }
							)
						),
						threeGet: t.Array(
							t.Object(
								{
									one: t.String(),
									oneGet: t.String()
								},
								{ additionalProperties: false }
							)
						)
					},
					{ additionalProperties: false }
				)
			)
		}
	)
	.listen(3000)

// console.log(response)
// expect(response).toEqual([
// 	{
// 		one: 'world',
// 		oneGet: 'world',
// 		three: [
// 			{
// 				one: 'world',
// 				oneGet: 'world'
// 			}
// 		],
// 		threeGet: [
// 			{
// 				one: 'world',
// 				oneGet: 'world'
// 			}
// 		]
// 	}
// ])
