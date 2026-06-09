import { t } from '../../src'
import { Memoirist } from 'memoirist'

const total = 1000
const stack: Memoirist<any>[] = []

{
	const t1 = performance.now()
	const memory = process.memoryUsage().heapTotal / 1024 / 1024

	for (let i = 0; i < total; i++) {
		for (let i = 0; i < 2; i++) {
			const router = new Memoirist()
			// router.add('GET', '/a', () => 'Hello, World!')
			// router.add('GET', '/b', () => 'Hello, World!')

			stack.push(router)
		}
	}

	const memoryAfter = process.memoryUsage().heapTotal / 1024 / 1024
	const took = performance.now() - t1

	console.log(
		Intl.NumberFormat().format(total),
		'routes took',
		+took.toFixed(4),
		'ms'
	)
	console.log('Average', +(took / total).toFixed(4), 'ms / route')

	console.log(memoryAfter - memory, 'MB memory used')
}
