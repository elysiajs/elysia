import { describe, it, expect } from 'bun:test'
import { tee } from '../../src/adapter/utils'

// H15: tee() drains the source AHEAD of the consumers (the afterResponse/trace
// timing contract) but bounds the unconsumed window so a long/infinite stream
// can't materialise.
describe('tee() bounded drain-ahead (H15)', () => {
	it('caps how far the producer races ahead of the slowest branch', async () => {
		let produced = 0
		async function* src() {
			// infinite
			while (true) {
				produced++
				yield produced
			}
		}

		const cap = 4
		const [client, listener] = await tee(src(), 2, cap)

		// listener drains as fast as it can (afterResponse-style), but it can't
		// pull the source past the slow client + cap
		const drained = (async () => {
			for await (const _ of listener) {
			}
		})()

		// slow client reads only 3
		for (let i = 0; i < 3; i++) await client.next()
		await new Promise((r) => setTimeout(r, 20))

		// producer must not race beyond client(3) + cap(4); allow 1 in-flight
		expect(produced).toBeLessThanOrEqual(3 + cap + 1)

		await client.return?.() // branch 0 return stops the infinite source
		await drained // listener now reaches completion
	})

	it('drains streams shorter than the cap eagerly (server-timing preserved)', async () => {
		async function* src() {
			for (let i = 0; i < 3; i++) yield i
		}

		const [response, listener] = await tee(src(), 2, 64)

		// observer drains fully and reaches completion without the client
		const seen: number[] = []
		for await (const v of listener) seen.push(v)
		expect(seen).toEqual([0, 1, 2])

		// the response branch still sees every value
		const got: number[] = []
		for await (const v of response) got.push(v)
		expect(got).toEqual([0, 1, 2])
	})
})
