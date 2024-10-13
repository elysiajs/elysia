import { Elysia, t } from '../src'
import { memoryUsage } from 'process'

const a = memoryUsage()

const app = new Elysia({ precompile: true }).get('a', 'a').listen(3000)

const l = 100000
for (let i = 0; i < l; i++) app.post(`/${i}`, () => 'a', {
	body: t.Object({
		username: t.String(),
		password: t.String()
	})
})

app.compile().listen(3000)

const mb = (byte: number) => (byte / 1024 / 1024).toFixed(2)

const b = memoryUsage()
console.log({
	// arrayBuffers: b.arrayBuffers - a.arrayBuffers,
	// external: b.external - a.external,
	heapTotal: mb(b.heapTotal - a.heapTotal),
	heapUsed: mb(b.heapUsed - a.heapUsed),
	rss: mb(b.rss - a.rss)
})
