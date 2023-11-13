import type {
	TraceHandler,
	TraceProcess,
	TraceReporter,
	TraceStream
} from './types'

const resolver = <T>() => {
	let resolve: (a: T) => any
	const promise = new Promise<T>((r) => {
		resolve = r
	})

	return [promise, resolve!] as const
}

type TraceResolver = [
	start: (value: TraceProcess<'begin'>) => any,
	end: (value: TraceProcess<'end'>) => any
]

const createSignal = () => {
	const [start, resolveStart] = resolver<TraceProcess<'begin'>>()
	const [end, resolveEnd] = resolver<TraceProcess<'end'>>()

	const children: Promise<TraceProcess<'begin'>>[] = []
	const resolvers: TraceResolver[] = []

	return {
		signal: start,
		consume: (trace: TraceStream) => {
			switch (trace.type) {
				case 'begin':
					if (trace.unit && children.length === 0)
						for (let i = 0; i < trace.unit; i++) {
							const [start, resolveStart] =
								resolver<TraceProcess<'begin'>>()
							const [end, resolveEnd] =
								resolver<TraceProcess<'end'>>()

							children.push(start)
							resolvers.push([
								(trace) => {
									resolveStart({
										children: [],
										end,
										name: trace.name ?? '',
										skip: false,
										time: trace.time
									})
								},
								(time) => {
									resolveEnd(time)
								}
							])
						}

					resolveStart({
						children,
						end,
						name: trace.name ?? '',
						skip: false,
						time: trace.time
					})
					break

				case 'end':
					resolveEnd(trace.time)
					break
			}
		},
		consumeChild(trace: TraceStream) {
			switch (trace.type) {
				case 'begin':
					if (!resolvers[0]) return
					const [resolveStart] = resolvers[0]

					resolveStart({
						children: [],
						end,
						name: trace.name ?? '',
						skip: false,
						time: trace.time
					})
					break

				case 'end':
					const child = resolvers.shift()
					if (!child) return

					child[1](trace.time)
			}
		},
		resolve() {
			resolveStart({
				children: [],
				end: new Promise((resolve) => resolve(0)),
				name: '',
				skip: true,
				time: 0
			})

			for (const [resolveStart, resolveEnd] of resolvers) {
				resolveStart({
					children: [],
					end: new Promise((resolve) => resolve(0)),
					name: '',
					skip: true,
					time: 0
				})

				resolveEnd(0)
			}

			resolveEnd(0)
		}
	}
}

export const createTraceListener = (
	getReporter: () => TraceReporter,
	totalListener: number,
	handler: TraceHandler<any, any>
) => {
	return async function trace(trace: TraceStream) {
		if (trace.event !== 'request' || trace.type !== 'begin') return

		const id = trace.id
		const reporter = getReporter()

		const request = createSignal()
		const parse = createSignal()
		const transform = createSignal()
		const beforeHandle = createSignal()
		const handle = createSignal()
		const afterHandle = createSignal()
		const error = createSignal()
		const response = createSignal()

		request.consume(trace)

		const reducer = (event: TraceStream) => {
			if (event.id === id)
				switch (event.event) {
					case 'request':
						request.consume(event)
						break

					case 'request.unit':
						request.consumeChild(event)
						break

					case 'parse':
						parse.consume(event)
						break

					case 'parse.unit':
						parse.consumeChild(event)
						break

					case 'transform':
						transform.consume(event)
						break

					case 'transform.unit':
						transform.consumeChild(event)
						break

					case 'beforeHandle':
						beforeHandle.consume(event)
						break

					case 'beforeHandle.unit':
						beforeHandle.consumeChild(event)
						break

					case 'handle':
						handle.consume(event)
						break

					case 'afterHandle':
						afterHandle.consume(event)
						break

					case 'afterHandle.unit':
						afterHandle.consumeChild(event)
						break

					case 'error':
						error.consume(event)
						break

					case 'error.unit':
						error.consumeChild(event)
						break

					case 'response':
						if (event.type === 'begin') {
							request.resolve()
							parse.resolve()
							transform.resolve()
							beforeHandle.resolve()
							handle.resolve()
							afterHandle.resolve()
							error.resolve()
						} else reporter.off('event', reducer)

						response.consume(event)
						break

					case 'response.unit':
						response.consumeChild(event)
						break

					case 'exit':
						request.resolve()
						parse.resolve()
						transform.resolve()
						beforeHandle.resolve()
						handle.resolve()
						afterHandle.resolve()
						error.resolve()
						break
				}
		}

		reporter.on('event', reducer)

		await handler({
			id,
			// @ts-ignore
			context: trace.ctx,
			// @ts-ignore
			set: trace.ctx?.set,
			// @ts-ignore
			store: trace.ctx?.store,
			time: trace.time,
			request: request.signal as any,
			parse: parse.signal as any,
			transform: transform.signal as any,
			beforeHandle: beforeHandle.signal as any,
			handle: handle.signal as any,
			afterHandle: afterHandle.signal as any,
			error: error.signal,
			response: response.signal as any
		})

		reporter.emit(`res${id}.${totalListener}`, undefined)
	}
}
