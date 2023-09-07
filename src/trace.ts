import type {
	TraceHandler,
	TraceProcess,
	TraceReporter,
	TraceStream
} from './types'

export const createTraceListener = (
	reporter: TraceReporter,
	handler: TraceHandler<any, any>
) => {
	return (event: TraceStream) => {
		const id = event.id

		if (event.event === 'request' && event.type === 'begin') {
			const createSignal = () => {
				let resolveHandle: (value: TraceProcess<'begin'>) => void
				let resolveHandleEnd: (value: TraceProcess<'end'>) => void

				let childIteration = -1
				const children: ((value: TraceProcess<'begin'>) => void)[] = []
				const endChildren: ((value: TraceProcess<'end'>) => void)[] = []

				let resolved = false
				const handle = new Promise<TraceProcess<'begin'>>((resolve) => {
					resolveHandle = (a) => {
						if (resolved) return
						else resolved = true

						resolve(a)
					}
				})

				let resolvedEnd = false
				const handleEnd = new Promise<TraceProcess<'end'>>(
					(resolve) => {
						resolveHandleEnd = (a) => {
							if (resolvedEnd) return
							else resolvedEnd = true

							if (childIteration === -1) childIteration = 0
							for (
								;
								childIteration < endChildren.length;
								childIteration++
							) {
								// eslint-disable-next-line prefer-const
								let end: TraceProcess<'end'>
								const start: TraceProcess<'begin'> = {
									name: 'anonymous',
									time: performance.now(),
									skip: true,
									end: new Promise<TraceProcess<'end'>>(
										(resolve) => {
											resolve(end)
										}
									),
									children: []
								}

								end = performance.now()

								children[childIteration + 1](start)
							}

							resolve(a)
						}
					}
				)

				return {
					signal: handle,
					consumeChild(event: TraceStream) {
						console.log(event)

						switch (event.type) {
							case 'begin':
								children[++childIteration]({
									name: event.name,
									time: event.time,
									end: new Promise<TraceProcess<'end'>>(
										(resolve) => {
											endChildren.push(resolve)
										}
									)
								} as TraceProcess<'begin'>)
								break

							case 'end':
								endChildren[childIteration](event.time)
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
									let resolveChild:
										| ((
												stream: TraceProcess<'begin'>
										  ) => void)
										| undefined

									unitsProcess.push(
										new Promise<TraceProcess<'begin'>>(
											(resolve) => {
												resolveChild = resolve as any
											}
										)
									)

									children.push(resolveChild!)
								}

								resolveHandle({
									// Begin always have name
									name: event.name!,
									time: event.time,
									skip: false,
									end: handleEnd as any,
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
					resolve() {
						if (resolved && resolvedEnd) return

						// eslint-disable-next-line prefer-const
						let end: TraceProcess<'end'>
						const start: TraceProcess<'begin'> = {
							name: 'anonymous',
							time: performance.now(),
							skip: true,
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
			const error = createSignal()
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
				request: request.signal as any,
				parse: parse.signal as any,
				transform: parse.signal as any,
				beforeHandle: beforeHandle.signal as any,
				handle: handle.signal as any,
				afterHandle: afterHandle.signal as any,
				error: error.signal,
				response: response.signal as any
			})
		}
	}
}
