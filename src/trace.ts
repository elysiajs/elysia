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
				let rejectHandle: (value: void) => void
				let rejectHandleEnd: (value: void) => void

				const children: ((stream: TraceProcess<'begin'>) => void)[] = []
				const childrenReject: (() => void)[] = []
				let endChild:
					| ((stream: TraceProcess<'end'>) => void)
					| undefined = undefined
				let childIteration = 0

				let resolved = false
				const handle = new Promise<TraceProcess<'begin'>>(
					(resolve, reject) => {
						rejectHandle = () => {
							if (resolved) return
							else resolved = true

							for (
								;
								childIteration < childrenReject.length;
								childIteration++
							)
								childrenReject[childIteration]()

							reject()
						}
						resolveHandle = (a) => {
							if (resolved) return
							else resolved = true

							resolve(a)
						}
					}
				).catch((error) => {
					throw error
				})

				let resolvedEnd = false
				const handleEnd = new Promise<TraceProcess<'end'>>(
					(resolve, reject) => {
						rejectHandleEnd = () => {
							if (resolvedEnd) return
							else resolvedEnd = true

							for (
								;
								childIteration < childrenReject.length;
								childIteration++
							)
								childrenReject[childIteration]()

							reject()
						}
						resolveHandleEnd = (a) => {
							if (resolvedEnd) return
							else resolvedEnd = true

							resolve(a)
						}
					}
				).catch((error) => {
					throw error
				})

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
									let resolveChild:
										| ((
												stream: TraceProcess<'begin'>
										  ) => void)
										| undefined

									let rejectChild: (() => void) | undefined

									unitsProcess.push(
										new Promise<TraceProcess<'begin'>>(
											(resolve, reject) => {
												resolveChild = resolve as any
												rejectChild = reject
											}
										).catch((error) => {
											throw error
										}) as any
									)

									children.push(resolveChild!)
									childrenReject.push(rejectChild!)
								}

								resolveHandle({
									// Begin always have name
									name: event.name!,
									time: event.time,
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
					reject() {
						if (resolved && resolvedEnd) return

						rejectHandle()
						rejectHandleEnd()
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
								request.reject()
								parse.reject()
								transform.reject()
								beforeHandle.reject()
								handle.reject()
								afterHandle.reject()
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
				response: response.signal as any
			})
		}
	}
}
