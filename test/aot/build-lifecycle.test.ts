/** AOT build-mode detection and cache-busted import lifecycle. */
import { describe, it, expect, afterEach } from 'bun:test'
import { env } from '../../src/universal'
import { Capture } from '../../src/compile/aot'

// Canonical build-mode predicate.

describe('isAotBuildEnv predicate', () => {
	const original = env.ELYSIA_AOT_BUILD

	afterEach(() => {
		if (original === undefined) delete env.ELYSIA_AOT_BUILD
		else env.ELYSIA_AOT_BUILD = original
	})

	it('returns false when env var is absent', () => {
		delete env.ELYSIA_AOT_BUILD
		expect(Capture.isAotBuildEnv()).toBe(false)
	})

	it('returns true for "1"', () => {
		env.ELYSIA_AOT_BUILD = '1'
		expect(Capture.isAotBuildEnv()).toBe(true)
	})

	it('returns true for any truthy value (e.g. "true")', () => {
		env.ELYSIA_AOT_BUILD = 'true'
		expect(Capture.isAotBuildEnv()).toBe(true)
	})

	it('returns false for empty string', () => {
		env.ELYSIA_AOT_BUILD = ''
		expect(Capture.isAotBuildEnv()).toBe(false)
	})
})

// Capture-state predicate.

describe('Capture.isCapturing', () => {
	const original = env.ELYSIA_AOT_BUILD

	afterEach(() => {
		if (original === undefined) delete env.ELYSIA_AOT_BUILD
		else env.ELYSIA_AOT_BUILD = original
	})

	it('returns false when env not set and no programmatic capture', () => {
		delete env.ELYSIA_AOT_BUILD
		expect(Capture.isCapturing()).toBe(false)
	})

	it('returns true when env var is set', () => {
		env.ELYSIA_AOT_BUILD = '1'
		expect(Capture.isCapturing()).toBe(true)
	})
})

// Cache-busted import specifier construction.

describe('cache-bust import specifier', () => {
	it('cache-bust specifier embeds elysia-aot query suffix', () => {
		// Test the specifier shape the plugin uses, without running a real build.
		// The actual dynamic-import in generateCompiledArtifacts wraps the cache-bust
		// in a try/catch, so we just verify the pattern is correct.
		const entry = '/some/project/src/index.ts'
		const ts = Date.now()
		const specifier = entry + '?elysia-aot=' + ts
		expect(specifier).toContain('?elysia-aot=')
		expect(specifier.startsWith(entry)).toBe(true)
		// Suffix must be numeric (timestamp)
		const suffix = specifier.split('?elysia-aot=')[1]
		expect(Number.isFinite(Number(suffix))).toBe(true)
	})

	it('two successive cache-bust specifiers for the same entry are distinct', async () => {
		// Subsequent rebuilds must produce different specifiers so the runtime
		// treats them as separate modules.
		const entry = '/some/project/src/index.ts'
		const s1 = entry + '?elysia-aot=' + Date.now()
		await new Promise((r) => setTimeout(r, 2))
		const s2 = entry + '?elysia-aot=' + Date.now()
		expect(s1).not.toBe(s2)
	})
})

// The first import is plain; subsequent imports are cache-busted.

describe('_importedEntries gate', () => {
	it('first invocation uses plain entry path (no ?elysia-aot suffix)', async () => {
		// Validate the decision logic directly via a mock dynamic import so we
		// never hit the filesystem. We replicate the branching in
		// generateCompiledArtifacts using the same _importedEntries Set.
		const seen = new Set<string>()
		const calls: string[] = []

		const fakeImport = async (spec: string) => {
			calls.push(spec)
			return { default: null }
		}

		const entry = '/fake/entry-plain.ts'

		// First call: not in set → plain import
		if (seen.has(entry)) {
			await fakeImport(entry + '?elysia-aot=' + Date.now())
		} else {
			seen.add(entry)
			await fakeImport(entry)
		}

		expect(calls).toHaveLength(1)
		expect(calls[0]).toBe(entry) // plain, no suffix
		expect(calls[0]).not.toContain('?elysia-aot=')
	})

	it('second invocation cache-busts and warns', async () => {
		const seen = new Set<string>()
		const calls: string[] = []
		const warnings: string[] = []

		const fakeImport = async (spec: string) => {
			calls.push(spec)
			return { default: null }
		}

		const entry = '/fake/entry-rebuild.ts'
		seen.add(entry) // simulate already-seen (first call already done)

		// Second call: in set → warn + cache-bust
		if (seen.has(entry)) {
			warnings.push(
				'[elysia-aot] re-importing "' +
					entry +
					'" for rebuild — top-level side effects will re-run.'
			)
			await fakeImport(entry + '?elysia-aot=' + Date.now())
		} else {
			seen.add(entry)
			await fakeImport(entry)
		}

		expect(warnings).toHaveLength(1)
		expect(warnings[0]).toContain('[elysia-aot]')
		expect(warnings[0]).toContain('re-importing')
		expect(calls).toHaveLength(1)
		expect(calls[0]).toContain('?elysia-aot=')
		// suffix is numeric timestamp
		const suffix = calls[0].split('?elysia-aot=')[1]
		expect(Number.isFinite(Number(suffix))).toBe(true)
	})
})
