import { traceEventIndex, type TraceEvent } from '../../constants'
import type { TraceReporter } from './utils'

export function createTraceCodegen(
	traceCount: number,
	phaseOn: (phase: TraceEvent) => boolean
) {
	const begin = (phase: TraceEvent, total: number, name = phase) => {
		if (!phaseOn(phase)) return ''
		const index = traceEventIndex[phase]
		let code = ''
		for (let i = 0; i < traceCount; i++)
			code +=
				`rp${i}=tr${i}.b(${index},${total}${name === phase ? '' : `,${JSON.stringify(name)}`})||` +
			`tr${i}.begin(${index},{id:c.rid,event:'${phase}',name:${JSON.stringify(name)},begin:performance.now(),total:${total}})\n`

		return code
	}

	const end = (phase: TraceEvent, error?: string) => {
		if (!phaseOn(phase)) return ''
		let code = ''
		for (let i = 0; i < traceCount; i++)
			code += `tr${i}.r(rp${i}${error ? `,${error}` : ''})\n`

		return code
	}

	const report = (phase: TraceEvent): TraceReporter | undefined => {
		if (!phaseOn(phase)) return

		return {
			resolveChild(name: string) {
				let begin = ''
				for (let i = 0; i < traceCount; i++)
					begin += `rpc${i}=rp${i}.resolveChild?.shift?.()?.({id:c.rid,event:'${phase}',name:${JSON.stringify(name)},begin:performance.now()})\n`
				return {
					begin,
					end(error?: string) {
						let code = ''
						for (let i = 0; i < traceCount; i++)
							code += error
								? `if(${error} instanceof Error){if(rpc${i})rpc${i}(${error});else tr${i}.gc(rp${i},${error})}else rpc${i}?.()\n`
								: `rpc${i}?.()\n`

						return code
					}
				}
			}
		}
	}

	return { begin, end, report }
}
