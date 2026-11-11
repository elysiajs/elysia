// Build fresh apps for each lane, send the same request, then compare response
// bytes and any recorded lifecycle observations.

import { describe, it, expect } from 'bun:test'
import {
	corpus,
	type CorpusRequest,
	type ObservableCorpusEntry
} from './corpus'
import { lanePairs, type LanePair, type Observe } from './lanes'
import {
	snapshot,
	comparators,
	formatMismatch,
	type ResponseSnapshot
} from './compare'

const entryInPair = (entry: ObservableCorpusEntry, pair: LanePair) =>
	!pair.requiresTag || entry.tags.includes(pair.requiresTag)

// Skip socket-specific responses and explicit lane exclusions.
const requestInPair = (request: CorpusRequest, pair: LanePair) =>
	(pair.oracle.transport === 'handle' ||
		!(request.tags ?? []).includes('handle-only')) &&
	!(request.excludeLanePairs ?? []).includes(pair.id)

// Bun >= 1.4.3 resets the socket when a response stream errors, so a listen
// lane's fetch can reject before any response arrives. Keep that as a snapshot
// so the two lanes are still compared instead of failing on the oracle.
const transportFailure = (error: unknown): ResponseSnapshot => ({
	status: 0,
	headers: [],
	setCookie: [],
	body: new Uint8Array(0),
	bodyError: `transport: ${(error as any)?.code ?? error}`
})

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
							const oracleRes = await oracle
								.handle(request.make())
								.catch(transportFailure)
							const oracleObs = oracle.observe?.()

							entry.recorder?.reset()
							const candidateRes = await candidate
								.handle(request.make())
								.catch(transportFailure)
							const candidateObs = candidate.observe?.()

							const [oSnap, cSnap] = await Promise.all([
								oracleRes instanceof Response
									? snapshot(oracleRes)
									: oracleRes,
								candidateRes instanceof Response
									? snapshot(candidateRes)
									: candidateRes
							])

							const respMismatch = comparators.response(
								ctx,
								oSnap,
								cSnap
							)
							if (respMismatch)
								throw new Error(formatMismatch(respMismatch))

							if (oracleObs !== undefined) {
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
