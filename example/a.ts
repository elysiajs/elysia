import { Elysia, t } from '../src'
import { memoryUsage } from 'process'

const a = memoryUsage()

const app = new Elysia({ precompile: true })
	.get('/', () => 'a')

const l = 1000
for (let i = 0; i < l; i++)
	app.get(`/${i}`, () => 'a')

app.compile()
app.listen(3000)

const b = memoryUsage()
console.log({
	// arrayBuffers: b.arrayBuffers - a.arrayBuffers,
	// external: b.external - a.external,
	heapTotal: b.heapTotal - a.heapTotal,
	heapUsed: b.heapUsed - a.heapUsed,
	rss: b.rss - a.rss
})
