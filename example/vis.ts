/**
 * Converts Bun's `bun:jsc` `profile()` output (JSC stackTraces format)
 * to the standard .cpuprofile format accepted by Speedscope / Chrome DevTools.
 *
 * Usage:
 *   import { profile } from "bun:jsc"
 *   import { convertToCpuProfile, writeCpuProfile } from "./jsc-to-cpuprofile"
 *
 *   const raw = profile(() => { yourCode() })
 *   writeCpuProfile(raw.stackTraces, "output.cpuprofile")
 */

import { existsSync, unlinkSync, writeFileSync } from 'fs'

// ─── JSC types ────────────────────────────────────────────────────────────────

interface JSCFrame {
	sourceID: number
	name: string
	location: string
	line: number
	column: number
	category: string
	flags: number // 1 = internal/built-in
}

interface JSCTrace {
	timestamp: number // seconds, high-res
	frames: JSCFrame[] // [0] = leaf, [last] = root
}

interface JSCSource {
	sourceID: number
	url?: string
}

export interface JSCStackTraces {
	interval: number
	traces: JSCTrace[]
	sources: JSCSource[]
}

// ─── .cpuprofile types ────────────────────────────────────────────────────────

interface CpuProfileCallFrame {
	functionName: string
	scriptId: string
	url: string
	lineNumber: number // 0-indexed
	columnNumber: number // 0-indexed
}

interface CpuProfileNode {
	id: number
	callFrame: CpuProfileCallFrame
	hitCount: number
	children: number[]
}

export interface CpuProfile {
	nodes: CpuProfileNode[]
	startTime: number // microseconds
	endTime: number // microseconds
	samples: number[] // node id per trace
	timeDeltas: number[] // microseconds between samples
}

// ─── Converter ────────────────────────────────────────────────────────────────

const UNKNOWN = 4294967295 // JSC sentinel for unknown line/col/sourceID

export function convertToCpuProfile(
	stackTraces: JSCStackTraces,
	options: {
		/** Drop internal runtime frames (flags === 1). Default: false */
		filterInternals?: boolean
	} = {}
): CpuProfile {
	const { traces, sources } = stackTraces
	const { filterInternals = false } = options

	if (traces.length === 0) {
		return {
			nodes: [],
			startTime: 0,
			endTime: 0,
			samples: [],
			timeDeltas: []
		}
	}

	// sourceID → url
	const sourceMap = new Map<number, string>()
	for (const src of sources) {
		sourceMap.set(src.sourceID, src.url ?? '')
	}

	let nextId = 1
	const nodes: CpuProfileNode[] = []
	// "parentId|sourceID|name|line|col" → node (trie dedup key)
	const trieMap = new Map<string, CpuProfileNode>()

	const root: CpuProfileNode = {
		id: nextId++,
		callFrame: {
			functionName: '(root)',
			scriptId: '0',
			url: '',
			lineNumber: -1,
			columnNumber: -1
		},
		hitCount: 0,
		children: []
	}
	nodes.push(root)

	const samples: number[] = []
	const timeDeltas: number[] = []
	let prevUs = 0

	for (let i = 0; i < traces.length; i++) {
		const trace = traces[i]
		const nowUs = Math.round(trace.timestamp * 1e6)
		timeDeltas.push(i === 0 ? 0 : nowUs - prevUs)
		prevUs = nowUs

		let frames = [...trace.frames].reverse() // root-first

		if (filterInternals) {
			frames = frames.filter((f) => f.flags !== 1)
		}

		let parent = root

		for (const frame of frames) {
			const line = frame.line === UNKNOWN ? -1 : frame.line - 1
			const col = frame.column === UNKNOWN ? -1 : frame.column - 1
			const key = `${parent.id}|${frame.sourceID}|${frame.name}|${line}|${col}`

			let node = trieMap.get(key)
			if (!node) {
				node = {
					id: nextId++,
					callFrame: {
						functionName: frame.name || '(anonymous)',
						scriptId: String(frame.sourceID),
						url: sourceMap.get(frame.sourceID) ?? '',
						lineNumber: line,
						columnNumber: col
					},
					hitCount: 0,
					children: []
				}
				nodes.push(node)
				trieMap.set(key, node)
				parent.children.push(node.id)
			}

			parent = node
		}

		// parent is now the leaf — record the hit
		parent.hitCount++
		samples.push(parent.id)
	}

	return {
		nodes,
		startTime: Math.round(traces[0].timestamp * 1e6),
		endTime: Math.round(traces[traces.length - 1].timestamp * 1e6),
		samples,
		timeDeltas
	}
}

// ─── File writer ──────────────────────────────────────────────────────────────

export function writeCpuProfile(
	stackTraces: JSCStackTraces,
	outPath: string,
	options?: Parameters<typeof convertToCpuProfile>[1]
): void {
	const profile = convertToCpuProfile(stackTraces, options)
	if (existsSync(outPath)) unlinkSync(outPath)
	writeFileSync(outPath, JSON.stringify(profile))
	console.log(`Wrote ${outPath}`)
}

// ─── Quick stats helper ───────────────────────────────────────────────────────

/** Prints the top N hottest frames by hit count — handy for a quick sanity check. */
export function printHotFrames(profile: CpuProfile, topN = 10): void {
	const sorted = [...profile.nodes]
		.filter((n) => n.hitCount > 0)
		.sort((a, b) => b.hitCount - a.hitCount)
		.slice(0, topN)

	const total = profile.samples.length
	console.log(`\nTop ${topN} hot frames (${total} total samples)\n`)

	for (const node of sorted) {
		const pct = ((node.hitCount / total) * 100).toFixed(1).padStart(5)
		const fn = node.callFrame.functionName.padEnd(32)
		const src = node.callFrame.url.split('/').slice(-2).join('/')
		const loc =
			node.callFrame.lineNumber >= 0
				? `:${node.callFrame.lineNumber + 1}`
				: ''
		console.log(`${pct}%  ${fn}  ${src}${loc}`)
	}
}

import { profile as bunProfile } from 'bun:jsc'

export function profile(name: string) {
	const { promise, resolve } = Promise.withResolvers()
	const data = bunProfile(() => promise)

	return () => {
		resolve()

		return data.then((data) => {
			writeCpuProfile(data.stackTraces as any, `${name}.cpuprofile`)

			return data
		})
	}
}
