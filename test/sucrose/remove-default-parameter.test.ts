import { describe, it, expect } from 'bun:test'
import { removeDefaultParameter } from '../../src/sucrose'

describe('removeDefaultParameter', () => {
	// The function removes default parameter values from a string parameter.
	it('should remove default parameter values from a string parameter', () => {
		const parameter = 'a=1, b=2, c=3'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('a, b, c')
	})

	// The function returns the modified string parameter.
	it('should return the modified string parameter', () => {
		const parameter = 'a=1, b=2, c=3'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('a, b, c')
	})

	// The function handles a string parameter with no default parameter values.
	it('should handle a string parameter with no default parameter values', () => {
		const parameter = 'a, b, c'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('a, b, c')
	})

	// The function handles a string parameter with no equals sign.
	it('should handle a string parameter with no equals sign', () => {
		const parameter = 'a, b, c'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('a, b, c')
	})

	// The function handles a string parameter with an equals sign but no comma or closing bracket.
	it('should handle a string parameter with an equals sign but no comma or closing bracket', () => {
		const parameter = 'a=1'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('a')
	})

	// The function handles a string parameter with an equals sign and a comma but no closing bracket.
	it('should handle a string parameter with an equals sign and a comma but no closing bracket', () => {
		const parameter = 'a=1, b=2, c'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('a, b, c')
	})

	// The function handles a string parameter with an equals sign and a closing bracket but no comma.
	it('should remove default parameter values from a string parameter when there is an equals sign and a closing bracket but no comma', () => {
		const parameter = '{ a = 1 }'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('{ a }')
	})

	// The function is case-sensitive and does not remove default parameter values with different capitalization.
	it('should not remove default parameter values with different capitalization', () => {
		const parameter = 'a=1, B=2, c=3'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('a, B, c')
	})

	// The function can handle whitespace characters around the equals sign.
	it('should remove default parameter values when there are whitespace characters around the equals sign', () => {
		const parameter = 'a = 1, b = 2, c = 3'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('a, b, c')
	})

	// Only the parameter that owns the equals sign loses its value, the leading one here.
	it('should remove a default value from the first parameter only', () => {
		const parameter = 'a=1, b, c'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('a, b, c')
	})

	// The comma terminator is searched from the equals sign, not from the start of the string,
	// so a comma that precedes the default value is not mistaken for its end.
	it('should remove a default value from the middle parameter only', () => {
		const parameter = 'a, b=2, c'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('a, b, c')
	})

	// A trailing default has neither a comma nor a closing bracket after it,
	// so the function truncates from the equals sign to the end of the string.
	it('should remove a default value from the last parameter only', () => {
		const parameter = 'a, b, c=3'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('a, b, c')
	})

	// The whole default expression is dropped in a single pass, the equals signs it
	// contains are removed with it rather than being treated as further parameters.
	it('should remove a default value that contains an equals sign', () => {
		const parameter = 'a = b === c, d'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('a, d')
	})

	// A comma nested inside the default value's own brackets does not separate parameters,
	// so it must not end the default, otherwise its tail leaks as a phantom parameter.
	it('should not end a default value at a comma nested inside brackets', () => {
		const parameter = 'a = [1, 2], b'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('a, b')
	})

	// A comma inside a string literal is data, not a separator, and must not end the default either.
	it('should not end a default value at a comma inside a string literal', () => {
		const parameter = "a = 'x,y', b"
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('a, b')
	})

	// Each quoting style is a separate arm of the scanner; without its own case the
	// comma inside the literal terminates the default and leaks the tail.
	it('should not end a default value at a comma inside a double-quoted string', () => {
		const parameter = 'a = "x,y", b'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('a, b')
	})

	it('should not end a default value at a comma inside a template literal', () => {
		const parameter = 'a = `x,y`, b'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('a, b')
	})

	// An escaped quote does not close the string, so the following comma is still
	// inside it. Without the escape skip the scan leaves string state early.
	it('should not end a default value at a comma after an escaped quote', () => {
		const parameter = "a = 'x\\',y', b"
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('a, b')
	})

	// Call arguments are the paren-depth arm — a default of `f(1,2)` has a comma
	// that belongs to the call, not to the parameter list.
	it('should not end a default value at a comma inside call parentheses', () => {
		const parameter = 'a = f(1,2), b'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('a, b')
	})

	// Object pattern where the comma wins over the closing brace as the terminator.
	it('should remove a default value from the first property of an object pattern', () => {
		const parameter = '{ a = 1, b }'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('{ a, b }')
	})

	// Object pattern where no comma follows the equals sign, so the closing brace terminates.
	it('should remove a default value from the last property of an object pattern', () => {
		const parameter = '{ a, b = 2 }'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('{ a, b }')
	})

	// The brace closing a nested object default belongs to that default, only a brace at
	// depth zero closes the pattern, so the pattern's own brace must survive.
	it('should not end a default value at the closing brace of a nested object default', () => {
		const parameter = '{ a = { b: 1 }, c }'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('{ a, c }')
	})

	// The loop runs until no equals sign remains, mixing both terminators in one pattern.
	it('should remove every default value in an object pattern with more than one', () => {
		const parameter = '{ a = 1, b = 2 }'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('{ a, b }')
	})

	// A regex literal is a string in disguise: the `,` inside it is data, and
	// without the regex arm its tail leaks as the phantom parameter `/`.
	it('should not end a default value at a comma inside a regex literal', () => {
		const parameter = 'a = /,/, b'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('a, b')
	})

	// The sharp direction: a `}` inside a regex would close the pattern early
	// and silently drop every parameter after it.
	it('should not end a default value at a closing brace inside a regex literal', () => {
		const parameter = 'a = /}/, b'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('a, b')
	})

	// A `/` inside a character class does not close the literal, so the scan
	// must stay inside it until the class is closed.
	it('should not end a regex literal at a slash inside a character class', () => {
		const parameter = 'a = /[/,]/, b'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('a, b')
	})

	// The class must also be closed again, otherwise the real terminating `/`
	// is swallowed and the value runs past its end.
	it('should leave a regex character class at its closing bracket', () => {
		const parameter = 'a = /[a],[b]/, c'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('a, c')
	})

	// An escaped slash does not close the literal, so the comma after it is
	// still regex source.
	it('should not end a regex literal at an escaped slash', () => {
		const parameter = 'a = /a\\/,b/, c'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('a, c')
	})

	// `/` after a value is division, not a regex. Reading it as a regex would
	// swallow everything up to the next `/` — including the comma that ends
	// the first default — and drop `b` entirely.
	it('should treat a slash after a value as division, not a regex literal', () => {
		const parameter = 'a = x / 2, b = y / 3, c'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('a, b, c')
	})

	// A closing `)`, `]` or `}` also ends an expression, so the `/` after it is
	// division. Each closer needs its own arm, and a later `/` in the string is
	// what a mis-read regex would run to — swallowing the parameter between.
	it('should treat a slash after a closing bracket as division', () => {
		const parameter =
			'a = (x) / 2, b = [1][0] / 3, c = { y: 1 } / 4, d = 5 / 6, e'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('a, b, c, d, e')
	})

	// A `/` after an operator looks like a regex but never closes. Falling back
	// to plain scanning keeps the comma terminator; giving up would truncate
	// the rest of the parameter list.
	it('should fall back to plain scanning on an unterminated regex literal', () => {
		const parameter = 'a = x++ / 2, b'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('a, b')
	})

	// `${` re-enters expression context, so the backtick that ends the
	// interpolated expression is not the one that ends the template.
	it('should not end a template literal at a backtick inside its interpolation', () => {
		const parameter = 'a = `${`x,y`}`, b'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('a, b')
	})

	// The `}` that closes an interpolation resumes the template literal. Reading
	// it as structure leaves the following backtick opening a new string, which
	// then swallows the rest of the parameter list.
	it('should resume the template literal after its interpolation closes', () => {
		const parameter = 'a = `${x}`, b'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('a, b')
	})

	// Only the brace that matches the `${` resumes the template, an inner
	// object's brace does not.
	it('should not resume a template literal at a nested object brace inside an interpolation', () => {
		const parameter = 'a = `${{ x: 1, y: 2 }}`, b'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('a, b')
	})

	// A closing quote ends a value just as an identifier does, so the `/` after
	// it divides. Read as a regex it runs to the next `/` — swallowing the comma
	// that ends this default and dropping the parameter that follows it.
	it('should treat a slash after a single-quoted string as division', () => {
		const parameter = "a = 'x' / 2, b = 'y' / 3, c"
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('a, b, c')
	})

	// Each quoting style is its own arm of the value test, so each needs its own
	// case: a missing arm drops a parameter rather than adding a phantom one.
	it('should treat a slash after a double-quoted string as division', () => {
		const parameter = 'a = "x" / 2, b = "y" / 3, c'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('a, b, c')
	})

	it('should treat a slash after a template literal as division', () => {
		const parameter = 'a = `x` / 2, b = `y` / 3, c'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('a, b, c')
	})

	// The `/` that closed a literal ends a value too, so the next `/` divides it.
	it('should treat a slash after a regex literal as division', () => {
		const parameter = 'a = /x/ / 2, b = /y/ / 3, c'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('a, b, c')
	})

	// The mirror image: a `/` that is itself the division operator is not a
	// value, so the `/` after it opens a literal. Only knowing which `/` closed
	// a literal separates the two — reading this one as division leaves the
	// comma inside the regex ending the default.
	it('should read a slash after a division operator as a regex literal', () => {
		const parameter = 'a = 2 / /,/, b'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('a, b')
	})

	// An operator keyword lexes as an identifier but is not a value, so what
	// follows it is a literal. Treating it as division leaves the comma inside
	// the regex ending the default and its tail leaking as a phantom name.
	it('should read a slash after typeof as a regex literal', () => {
		const parameter = 'a = typeof /,/, b'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('a, b')
	})

	it('should read a slash after void as a regex literal', () => {
		const parameter = 'a = void /}/, b'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('a, b')
	})

	// A property spelled like a keyword is still a value — the `.` before it is
	// what tells them apart, without it the division is read as a literal and
	// swallows the parameter after it.
	it('should treat a slash after a member named like a keyword as division', () => {
		const parameter = 'a = x.in / 2, b = y.of / 3, c'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('a, b, c')
	})

	// `Function.prototype.toString` returns the source verbatim, so on CRLF
	// source the character before the operator is a `\r`. Skipping only space,
	// tab and LF leaves it standing in for the value and the `/` is misread.
	it('should treat a slash after a carriage return as division', () => {
		const parameter = "a = 'x'\r/ 2, b = 'y'\r/ 3, c"
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('a, b, c')
	})

	// Every default goes in one forward pass, so the `,` or `}` that terminated
	// each value has to survive the splice: lose it and the parameters merge or
	// the pattern loses its own brace.
	it('should remove several defaults in a row without losing their terminators', () => {
		const parameter = '{ a = f(1,2), b = /,/, c = `${x}`, d }'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('{ a, b, c, d }')
	})

	// Separators are normalised on the way out even when the loop never runs.
	it('should normalize spacing around commas when there is no default value', () => {
		const parameter = ' a ,b ,  c '
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('a, b, c')
	})

	// The function reassigns its local binding, the caller's string is left as it was.
	it('should not mutate the input string', () => {
		const parameter = 'a=1, b=2'
		const result = removeDefaultParameter(parameter)
		expect(result).toEqual('a, b')
		expect(parameter).toEqual('a=1, b=2')
	})
})
