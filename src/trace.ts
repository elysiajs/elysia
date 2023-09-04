import { isFnUse } from './compose'
import type {
	TraceHandler,
	TraceProcess,
	TraceReporter,
	TraceStream
} from './types'

export const createTraceListener =
	(reporter: TraceReporter, handler: TraceHandler<any, any>) => (event: TraceStream) => {
		const id = event.id

		if (event.event === 'request' && event.type === 'begin') {
			const createSignal = () => {
				let resolveHandle: (value: TraceProcess<'begin'>) => void
				let resolveHandleEnd: (value: TraceProcess<'end'>) => void

				let resolved = false
				const handle = new Promise<TraceProcess<'begin'>>((resolve) => {
					resolveHandle = (a) => {
						if (!resolved) resolved = true

						resolve(a)
					}
				})

				let resolvedEnd = false
				const handleEnd = new Promise<TraceProcess<'end'>>(
					(resolve) => {
						resolveHandleEnd = (a) => {
							if (!resolvedEnd) resolvedEnd = true

							resolve(a)
						}
					}
				)

				const children: ((stream: TraceProcess<'begin'>) => void)[] = []
				let endChild:
					| ((stream: TraceProcess<'end'>) => void)
					| undefined = undefined
				let childIteration = 0

				return {
					signal: handle,
					consumeChild(event: TraceStream) {
						switch (event.type) {
							case 'begin':
								children[childIteration++]({
									name: event.name,
									time: event.time,
									end: new Promise<TraceProcess<'end'>>(
										(resolve) => {
											endChild = resolve
										}
									)
								} as TraceProcess<'begin'>)
								break

							case 'end':
								endChild?.(event.time)
								break
						}
					},
					consume(event: TraceStream) {
						switch (event.type) {
							case 'begin':
								const unitsProcess: Promise<
									TraceProcess<'begin'>
								>[] = []

								const units = event.unit ?? 0
								for (let i = 0; i < units; i++) {
									let resolve:
										| ((
												stream: TraceProcess<'begin'>
										  ) => void)
										| undefined

									unitsProcess.push(
										new Promise<TraceProcess<'begin'>>(
											(r) => {
												resolve = r as any
											}
										)
									)

									children.push(resolve!)
								}

								resolveHandle({
									// Begin always have name
									name: event.name!,
									time: event.time,
									end: handleEnd,
									children: unitsProcess
								} satisfies TraceProcess<'begin'>)
								break

							case 'end':
								resolveHandleEnd(
									event.time as TraceProcess<'end'>
								)
								break
						}
					},
					forceResolve() {
						if (resolved && resolvedEnd) return

						// eslint-disable-next-line prefer-const
						let end: TraceProcess<'end'>
						const start: TraceProcess<'begin'> = {
							name: 'anonymous',
							time: performance.now(),
							end: new Promise<TraceProcess<'end'>>((resolve) => {
								resolve(end)
							}),
							children: []
						}

						end = performance.now()

						resolveHandle(start)
						resolveHandleEnd(end)
					}
				}
			}

			const request = createSignal()
			const parse = createSignal()
			const transform = createSignal()
			const beforeHandle = createSignal()
			const handle = createSignal()
			const afterHandle = createSignal()
			const response = createSignal()

			request.consume(event)

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

						case 'response':
							if (event.type === 'begin') {
								request.forceResolve()
								parse.forceResolve()
								transform.forceResolve()
								beforeHandle.forceResolve()
								handle.forceResolve()
								afterHandle.forceResolve()
							} else reporter.off('event', reducer)

							response.consume(event)
							break

						case 'response.unit':
							response.consumeChild(event)
							break
					}
			}

			reporter.on('event', reducer)

			handler({
				id: event.id,
				// @ts-ignore
				context: event.ctx,
				// @ts-ignore
				set: event.ctx?.set,
				// @ts-ignore
				store: event.ctx?.store,
				time: event.time,
				request: request.signal,
				parse: parse.signal,
				transform: parse.signal,
				beforeHandle: beforeHandle.signal,
				handle: handle.signal,
				afterHandle: afterHandle.signal,
				response: response.signal
			})
		}
	}