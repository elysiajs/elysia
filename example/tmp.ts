import { profile } from './vis'
const stop = !process.env.ELYSIA_AOT_BUILD ? profile('app') : () => {}
const memory = process.memoryUsage().rss

const t1 = performance.now()

import { Elysia, t } from '../src'
import { flushMemory } from '../src/memory'

export const app = new Elysia()

for (let i = 0; i < 1_000; i++) {
	app.post(
		`/${i}`,
		{
			query: t.Object({
				[`name${i}`]: t.String()
			}),
			body: t.Object({
				[`id${i}`]: t.String({ format: 'uuid' }),
				title: t.String(),
				count: t.Number(),
				active: t.Boolean(),
				tags: t.Array(t.String()),
				note: t.Optional(t.String())
			})
		},
		() => 'ok'
	)
}

app.listen(3001)

// await app
// 	.handle('/1?name1=saltyaom', {
// 		method: 'POST',
// 		body: JSON.stringify({
// 			id1: '550e8400-e29b-41d4-a716-446655440000',
// 			title: 'Hello',
// 			count: 42,
// 			active: true,
// 			tags: ['foo', 'bar'],
// 			note: 'This is a note'
// 		}),
// 		headers: {
// 			'Content-Type': 'application/json'
// 		}
// 	})
// 	.then((x) => x.text())
// 	.then(console.log)

if (!process.env.ELYSIA_AOT_BUILD) {
	app.compile()
	console.log('Full compile in', performance.now() - t1, 'ms')
	stop()
	flushMemory()
	Bun.gc(true)
	console.log(
		'Memory:',
		((process.memoryUsage().rss - memory) / 1024 / 1024).toFixed(1),
		'MB (rss)'
	)

	const snapshot = Bun.generateHeapSnapshot('v8', 'arraybuffer')
	await Bun.write('heap.heapsnapshot', snapshot)

	console.log('Generated snapshot')
}
