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

	// `import <clause> from 'elysia'` at line start; skip `import type ...`.
	// The trailing `(\\s*(?:with|assert)\\s*\\{[^}]*\\})?` consumes an optional
	const importRe = new RegExp(
		`(^|\\n)([ \\t]*)import\\s+(?!type\\b)([\\s\\S]*?)\\s+from\\s*(['"])${escape(from)}\\4(\\s*(?:with|assert)\\s*\\{[^}]*\\})?`,
		'g'
	)

	const edits: { start: number; end: number; text: string }[] = []
	let m: RegExpExecArray | null

	while ((m = importRe.exec(code))) {
		const [full, lead, indent, clause, , attributes] = m

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

		// Re-attach an import-attributes clause (`with`/`assert {...}`) to each
		// split import so it is preserved, not orphaned onto the wrong line
		const attr = attributes ?? ''
		const lines: string[] = []
		if (keptClause) lines.push(`import ${keptClause} from '${from}'${attr}`)
		lines.push(`import * as ${alias} from '${typeFrom}'${attr}`)

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
	assert(
		rewriteTypeImport(
			`import { t } from 'elysia'\nconst x = t\nx.Object()`
		),
		`import * as t from 'elysia/type'\nconst x = t\nx.Object()`,
		'aliased value still rewritten (1:1 safe)'
	)
	console.log('all treeshake transform checks passed')
}
