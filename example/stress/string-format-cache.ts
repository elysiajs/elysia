import { t } from '../../src'
import { flushMemory } from '../../src/memory'
import { environment, memorySnapshot } from './utils'

const total = 10_000
const json = process.argv.includes('--json')

const baseline = memorySnapshot()

for (let i = 0; i < total; i++)
	void t.String({ format: `string-format-cache-${i}` })

const afterPopulation = memorySnapshot()
flushMemory()
const afterFlush = memorySnapshot()

const delta = (
	after: ReturnType<typeof memorySnapshot>,
	before: ReturnType<typeof memorySnapshot>
) => ({
	currentMetric: after.metric,
	currentBytesDelta: after.current - before.current,
	heapSizeMetric:
		'heapSize' in after && 'heapSize' in before
			? 'bun:jsc.heapSize'
			: undefined,
	heapSizeBytesDelta:
		'heapSize' in after && 'heapSize' in before
			? after.heapSize - before.heapSize
			: undefined,
	objectCountMetric:
		'objectCount' in after && 'objectCount' in before
			? 'bun:jsc.objectCount'
			: undefined,
	objectCountDelta:
		'objectCount' in after && 'objectCount' in before
			? after.objectCount - before.objectCount
			: undefined
})

const result = {
	kind: 'string-format-cache',
	total,
	environment: environment(),
	snapshots: { baseline, afterPopulation, afterFlush },
	deltas: {
		afterPopulation: delta(afterPopulation, baseline),
		afterFlush: delta(afterFlush, baseline)
	}
}

if (json) console.log(JSON.stringify(result))
else {
	console.log('String format cache retention')
	console.log(result)
}
