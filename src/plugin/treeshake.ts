export interface RewriteOptions {
	/** Specifier the app imports `t` from. @default 'elysia' */
	from?: string
	/** Specifier to redirect `t` to. @default `${from}/type` */
	typeFrom?: string
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function nonCodeSpans(code: string): [start: number, end: number][] {
	const spans: [number, number][] = []
	const length = code.length
	let i = 0

	while (i < length) {
		const c = code.charCodeAt(i)

		// // line comment
		if (c === 47 && code.charCodeAt(i + 1) === 47) {
			const start = i
			const newline = code.indexOf('\n', i + 2)
			i = newline === -1 ? length : newline
			spans.push([start, i])
			continue
		}

		// /* block comment */
		if (c === 47 && code.charCodeAt(i + 1) === 42) {
			const start = i
			const end = code.indexOf('*/', i + 2)
			i = end === -1 ? length : end + 2
			spans.push([start, i])
			continue
		}

		// ' or " string (single line)
		if (c === 34 || c === 39) {
			const start = i++
			while (i < length) {
				const d = code.charCodeAt(i)
				if (d === 92) i += 2
				else if (d === c || d === 10) break
				else i++
			}
			i++
			spans.push([start, i])
			continue
		}

		// ` template literal, including nesting through ${ ... }
		if (c === 96) {
			const start = i++
			// stack: -1 = template text, >= 0 = brace depth inside a `${ }`
			const stack: number[] = [-1]

			while (i < length && stack.length) {
				const d = code.charCodeAt(i)
				if (d === 92) {
					i += 2
					continue
				}

				const top = stack[stack.length - 1]
				if (top === -1) {
					// template text
					if (d === 96) stack.pop()
					else if (d === 36 && code.charCodeAt(i + 1) === 123) {
						stack.push(0)
						i++
					}
				} else {
					// interpolation code
					if (d === 96) stack.push(-1)
					else if (d === 123) stack[stack.length - 1]++
					else if (d === 125) {
						if (top === 0) stack.pop()
						else stack[stack.length - 1]--
					}
				}

				i++
			}

			spans.push([start, i])
			continue
		}

		i++
	}

	return spans
}

export function rewriteTypeImport(
	code: string,
	options: RewriteOptions = {}
): string {
	const from = options.from ?? 'elysia'
	const typeFrom = options.typeFrom ?? `${from}/type`

	if (!code.includes(from)) return code

	// Only match import clauses that can contain a named `t` binding
	const importRe = new RegExp(
		`(^|\\n)([ \\t]*)import\\s+(?!type\\b)((?:[A-Za-z_$][\\w$]*\\s*,\\s*)?\\{[^}]*\\})\\s+from\\s*(['"])${escape(from)}\\4(\\s*(?:with|assert)\\s*\\{[^}]*\\})?`,
		'g'
	)

	const spans = nonCodeSpans(code)
	const edits: { start: number; end: number; text: string }[] = []
	let m: RegExpExecArray | null

	while ((m = importRe.exec(code))) {
		const [full, lead, indent, clause, , attributes] = m

		// import-shaped text inside a template literal/comment is data, not import
		const keyword = m.index + lead.length + indent.length
		if (spans.some(([start, end]) => keyword >= start && keyword < end))
			continue

		const braceStart = clause.indexOf('{')
		if (braceStart === -1) continue // no named imports → nothing to split
		const braceEnd = clause.indexOf('}', braceStart)
		if (braceEnd === -1) continue

		const before = clause.slice(0, braceStart).trim() // default import, e.g. "Default,"
		const memberSource = clause.slice(braceStart + 1, braceEnd)
		// Commas inside comments or string-named imports are not member separators.
		// Leave complex-but-valid imports untouched instead of guessing.
		if (/['"`]|\/\/|\/\*/.test(memberSource)) continue

		const members = memberSource
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
