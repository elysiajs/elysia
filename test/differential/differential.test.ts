/**
 * D2 differential harness — the matrix (n-proof.md D2, P0-8..P0-11).
 *
 * For each v1 lane pair × each corpus entry × each request:
 *   build a FRESH oracle app and a FRESH candidate app, fire the SAME request
 *   against both, and assert byte-identical responses (compare.ts rules).
 *   Observation entries (P0-9) additionally read each lane's per-request
 *   hook-fire log THROUGH `lane.observe()` and assert it matches across lanes
 *   (structural deep-equal, via the `observation` comparator).
 *
 * Lane pairs are grouped into describe blocks. Listen-transport pairs subset the
 * corpus to entries tagged 'safe-for-socket' (a real socket cannot receive the
 * short-host `http://a/` request — that entry is 'handle-only'; see README).
 *
 * Known-divergence entries (lanes disagree TODAY) are skipped via `test.todo`
 * naming the owning fix task. There are currently NONE — the custom-thenable
 * bug (A5) reproduces identically across all v1 lanes, so it is PINNED, not
 * skipped. See README.
 */

import { describe, it, expect } from 'bun:test'
import { corpus, type ObservableCorpusEntry } from './corpus'
import { lanePairs, type LanePair, type Observe } from './lanes'
import { snapshot, comparators, formatMismatch } from './compare'

/** Does this entry participate in this pair (tag gate)? */
const entryInPair = (entry: ObservableCorpusEntry, pair: LanePair): boolean =>
	!pair.requiresTag || entry.tags.includes(pair.requiresTag)

/**
 * A request is excluded from listen (socket) pairs if it is tagged 'handle-only'
 * — e.g. it echoes the request `host` header, which on a real socket carries the
 * ephemeral port and would differ per-lane (a harness artifact, not a divergence).
 */
const requestInPair = (request: { tags?: string[] }, pair: LanePair): boolean =>
	pair.oracle.transport === 'handle' ||
	!(request.tags ?? []).includes('handle-only')

/** Entries flagged as a real pre-existing divergence — skipped, not run. */
const isKnownDivergence = (entry: ObservableCorpusEntry): boolean =>
	entry.tags.includes('known-divergence')

/**
 * P0-6a: dispose BOTH lanes even if one dispose throws, aggregating errors so a
 * candidate-dispose failure cannot silently skip the oracle-dispose (which frees
 * the oracle's listen port). Runs every dispose, then rethrows the first failure
 * with the rest attached.
 */
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
					it(`${entry.id} › ${request.id}`, async () => {
						// The corpus recorder is shared with `define` via closure;
						// this snapshotter is what each lane returns from observe()
						// (P0-9). Undefined for entries with no recorder.
						const observe: Observe | undefined = entry.recorder
							? () => [...entry.recorder!.events]
							: undefined

						// P0-6a: construct INSIDE try so a candidate.make() throw
						// cannot leak an already-built oracle. Both are disposed in
						// finally regardless of which (if any) was built.
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

							// Reset the shared recorder, run oracle, read its
							// observation THROUGH lane.observe() (P0-9) immediately —
							// before the candidate run overwrites the shared recorder.
							entry.recorder?.reset()
							const oracleRes = await oracle.handle(
								request.make()
							)
							const oracleObs = oracle.observe?.()

							entry.recorder?.reset()
							const candidateRes = await candidate.handle(
								request.make()
							)
							const candidateObs = candidate.observe?.()

							const [oSnap, cSnap] = await Promise.all([
								snapshot(oracleRes),
								snapshot(candidateRes)
							])

							// Dispatch response comparison through the named
							// comparator registry (P0-9) so B5 can register more
							// without touching the matrix.
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

								// The observation must be non-empty for an observed
								// entry — a silently-empty log is a false pass.
								expect(
									(oracleObs as unknown[]).length
								).toBeGreaterThan(0)
							}
						} finally {
							// P0-11 + P0-6a: dispose BOTH in finally, aggregating
							// errors so one failure cannot skip the other.
							await disposeAll([candidate, oracle])
						}
					})
				}
			}

			if (isKnownDivergence(entry))
				describe.todo(
					`${entry.id} (known-divergence — see README)`,
					describeEntry
				)
			else describe(entry.id, describeEntry)
		}
	})
}
