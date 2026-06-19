// Build-time transform that makes `import { t } from 'elysia'` tree-shakeable.
//
// `t` is a runtime value, so `t.Object()` can't shake. But `elysia/type` is the
// SAME 318-key surface as `t` (1:1), and `import * as t from 'elysia/type'` +
// static `t.Object` DOES shake (esbuild rewrites static namespace access into
// named imports). So we rewrite the IMPORT line only — every `t.Object()` call
// site is untouched:
//
//   import { Elysia, t } from 'elysia'
//        ↓
//   import { Elysia } from 'elysia'
//   import * as t from 'elysia/type'
//
// Because `elysia/type` is 1:1 with `t`, the rewrite is semantically identical —
// it cannot break: `t.X`, `t[key]`, and `t` passed as a value all still resolve
// (the namespace has every key); only static `t.X` additionally tree-shakes.
// ponytail: 1:1 means no usage validation is needed — just split the import.

export interface RewriteOptions {
	/** Specifier the app imports `t` from. @default 'elysia' */
	from?: string
	/** Specifier to redirect `t` to. @default `${from}/type` */
	typeFrom?: string
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function rewriteTypeImport(
	code: string,
	options: RewriteOptions = {}
): string {
	const from = options.from ?? 'elysia'
	const typeFrom = options.typeFrom ?? `${from}/type`

	if (!code.includes(from)) return code

	// `import <clause> from 'elysia'` at line start; skip `import type ...`
	const importRe = new RegExp(
		`(^|\\n)([ \\t]*)import\\s+(?!type\\b)([\\s\\S]*?)\\s+from\\s*(['"])${escape(from)}\\4`,
		'g'
	)

	const edits: { start: number; end: number; text: string }[] = []
	let m: RegExpExecArray | null

	while ((m = importRe.exec(code))) {
		const [full, lead, indent, clause] = m

		const braceStart = clause.indexOf('{')
		if (braceStart === -1) continue // no named imports → nothing to split
		const braceEnd = clause.indexOf('}', braceStart)
		if (braceEnd === -1) continue

		const before = clause.slice(0, braceStart).trim() // default import, e.g. "Default,"
		const members = clause
			.slice(braceStart + 1, braceEnd)
			.split(',')
			.map((x) => x.trim())
			.filter(Boolean)

		let alias: string | undefined
		const kept: string[] = []
		for (const member of members) {
			const t = member.match(/^t(?:\s+as\s+([A-Za-z_$][\w$]*))?$/)
			if (t && !alias) alias = t[1] ?? 't'
			else kept.push(member)
		}
		if (!alias) continue // `t` not imported here

		const head = before.replace(/,\s*$/, '').trim() // default specifier (rare for elysia)
		const keptClause =
			head && kept.length
				? `${head}, { ${kept.join(', ')} }`
				: head
					? head
					: kept.length
						? `{ ${kept.join(', ')} }`
						: ''

		const lines: string[] = []
		if (keptClause) lines.push(`import ${keptClause} from '${from}'`)
		lines.push(`import * as ${alias} from '${typeFrom}'`)

		edits.push({
			start: m.index,
			end: m.index + full.length,
			text: lead + indent + lines.join('\n' + indent)
		})
	}

	if (!edits.length) return code

	let out = code
	for (const e of edits.sort((a, b) => b.start - a.start))
		out = out.slice(0, e.start) + e.text + out.slice(e.end)
	return out
}

// ponytail: runnable self-check — `bun run src/plugin/treeshake.ts`
if (import.meta.main) {
	const assert = (got: string, want: string, label: string) => {
		if (got.trim() !== want.trim()) {
			console.error(
				`✗ ${label}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`
			)
			process.exit(1)
		}
		console.log(`✓ ${label}`)
	}

	assert(
		rewriteTypeImport(`import { Elysia, t } from 'elysia'\nt.Object()`),
		`import { Elysia } from 'elysia'\nimport * as t from 'elysia/type'\nt.Object()`,
		'splits Elysia + t'
	)
	assert(
		rewriteTypeImport(`import { t } from 'elysia'\nt.Number()`),
		`import * as t from 'elysia/type'\nt.Number()`,
		'sole t → namespace'
	)
	assert(
		rewriteTypeImport(`import { t as x } from 'elysia'\nx.Object()`),
		`import * as x from 'elysia/type'\nx.Object()`,
		'aliased t'
	)
	assert(
		rewriteTypeImport(`import { Elysia } from 'elysia'\nnew Elysia()`),
		`import { Elysia } from 'elysia'\nnew Elysia()`,
		'no t → untouched'
	)
	assert(
		rewriteTypeImport(`import type { t } from 'elysia'\nx`),
		`import type { t } from 'elysia'\nx`,
		'import type → untouched'
	)
	// 1:1 means even dynamic/aliased usage is safe — still rewritten, still correct
	assert(
		rewriteTypeImport(`import { t } from 'elysia'\nconst x = t\nx.Object()`),
		`import * as t from 'elysia/type'\nconst x = t\nx.Object()`,
		'aliased value still rewritten (1:1 safe)'
	)
	console.log('all treeshake transform checks passed')
}
