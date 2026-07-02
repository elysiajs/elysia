import { init, parse } from 'es-module-lexer'

export interface RewriteOptions {
	/** Specifier the app imports `t` from. @default 'elysia' */
	from?: string
	/** Specifier to redirect `t` to. @default `${from}/type` */
	typeFrom?: string
}

export async function rewriteTypeImport(
	code: string,
	options: RewriteOptions = {}
): Promise<string> {
	const from = options.from ?? 'elysia'
	const typeFrom = options.typeFrom ?? `${from}/type`

	if (!code.includes(from)) return code

	// es-module-lexer yields exact top-level import spans — import-shaped
	// text inside strings/template literals/comments is never rewritten
	await init

	let imports: ReturnType<typeof parse>[0]
	try {
		;[imports] = parse(code)
	} catch {
		// syntax error — leave the file for the bundler to diagnose
		return code
	}

	const edits: { start: number; end: number; text: string }[] = []

	for (const imp of imports) {
		// skip dynamic imports and other specifiers
		if (imp.d !== -1 || imp.n !== from) continue

		const statement = code.slice(imp.ss, imp.se)
		if (/^import\s+type\b/.test(statement)) continue

		// clause = between the `import` keyword and the `from` keyword
		const clauseEnd = code.lastIndexOf('from', imp.s)
		if (clauseEnd <= imp.ss) continue // side-effect-only import
		const clause = code.slice(imp.ss + 'import'.length, clauseEnd).trim()

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

		// Preserve an import-attributes clause (`with`/`assert {...}`)
		const attr = code.slice(imp.e + 1, imp.se)

		// match the original line's indentation for the inserted line
		const lineStart = code.lastIndexOf('\n', imp.ss - 1) + 1
		const lead = code.slice(lineStart, imp.ss)
		const indent = /^[ \t]*$/.test(lead) ? lead : ''

		const lines: string[] = []
		if (keptClause) lines.push(`import ${keptClause} from '${from}'${attr}`)
		lines.push(`import * as ${alias} from '${typeFrom}'${attr}`)

		edits.push({
			start: imp.ss,
			end: imp.se,
			text: lines.join('\n' + indent)
		})
	}

	if (!edits.length) return code

	let out = code
	for (const e of edits.sort((a, b) => b.start - a.start))
		out = out.slice(0, e.start) + e.text + out.slice(e.end)
	return out
}
