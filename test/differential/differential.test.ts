// Build fresh apps for each lane, send the same request, then compare response
// bytes and any recorded lifecycle observations.

import { describe, it, expect } from 'bun:test'
import { corpus, type ObservableCorpusEntry } from './corpus'
import { lanePairs, type LanePair, type Observe } from './lanes'
import { snapshot, comparators, formatMismatch } from './compare'

const entryInPair = (entry: ObservableCorpusEntry, pair: LanePair): boolean =>
	!pair.requiresTag || entry.tags.includes(pair.requiresTag)

// Socket lanes skip responses that include the lane-specific port.
const requestInPair = (
	request: { tags?: string[]; excludePairs?: string[] },
	pair: LanePair
): boolean =>
	!request.excludePairs?.includes(pair.id) &&
	(pair.oracle.transport === 'handle' ||
		!(request.tags ?? []).includes('handle-only'))

// Run every disposer before reporting their failures.
const disposeAll = async (
	lanes: Array<{ dispose(): Promise<void> } | undefined>
): Promise<void> => {
	const errors: unknown[] = []
	for (const lane of lanes) {
		if (!lane) continue
		try {
			await lane.dispose()
		} catch (error) {
			errors.push(error)
		}
	}
	if (errors.length === 1) throw errors[0]
	if (errors.length > 1)
		throw new AggregateError(errors, 'multiple lane disposals failed')
}

for (const pair of lanePairs) {
	describe(`differential: ${pair.id}`, () => {
		for (const entry of corpus) {
			if (!entryInPair(entry, pair)) continue

			const describeEntry = () => {
				for (const request of entry.requests) {
					if (!requestInPair(request, pair)) continue
					it(request.id, async () => {
						const observe: Observe | undefined = entry.recorder
							? () => [...entry.recorder!.events]
							: undefined
						const drainExpectedObservation = async () => {
							if (!Array.isArray(request.expectedObservation)) {
								await Bun.sleep(0)
								return
							}
							for (
								let attempt = 0;
								attempt < 20 &&
								entry.recorder!.events.length <
									request.expectedObservation.length;
								attempt++
							)
								await Bun.sleep(1)
						}

						// Partial setup must still dispose a successfully built lane.
						let oracle:
							| Awaited<ReturnType<typeof pair.oracle.make>>
							| undefined
						let candidate:
							| Awaited<ReturnType<typeof pair.candidate.make>>
							| undefined
						try {
							oracle = await pair.oracle.make(
								entry.define,
								observe
							)
							candidate = await pair.candidate.make(
								entry.define,
								observe
							)

							const ctx = {
								corpusId: entry.id,
								requestId: request.id,
								lanePair: pair.id
							}

							entry.recorder?.reset()
							const oracleRes = await oracle.handle(
								request.make()
							)
							const oSnap = await snapshot(oracleRes)
							await drainExpectedObservation()
							const oracleObs = oracle.observe?.()

							entry.recorder?.reset()
							const candidateRes = await candidate.handle(
								request.make()
							)
							const cSnap = await snapshot(candidateRes)
							await drainExpectedObservation()
							const candidateObs = candidate.observe?.()

							const respMismatch = comparators.response(
								ctx,
								oSnap,
								cSnap
							)
							if (respMismatch)
								throw new Error(formatMismatch(respMismatch))

							if (oracleObs !== undefined) {
								if (request.expectedObservation !== undefined)
									expect(oracleObs).toEqual(
										request.expectedObservation
									)
								const obsMismatch = comparators.observation(
									ctx,
									oracleObs,
									candidateObs
								)
								if (obsMismatch)
									throw new Error(formatMismatch(obsMismatch))

								expect(
									(oracleObs as unknown[]).length
								).toBeGreaterThan(0)
							}
						} finally {
							await disposeAll([candidate, oracle])
						}
					})
				}
			}

			describe(entry.id, describeEntry)
		}
	})
}
