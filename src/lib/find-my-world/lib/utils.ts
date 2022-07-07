export const escapeRegExp = (value: string) =>
    value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const removeDuplicateSlashes = (path: string) =>
    path.replace(/\/\/+/g, '/')

export const trimLastSlash = (path: string) => {
    if (path.length && path.charCodeAt(path.length - 1) === 47)
        return path.slice(0, -1)

    return path
}

export const trimRegExpStartAndEnd = (regexString: string) => {
    if (regexString.charCodeAt(1) === 94)
        regexString = regexString.slice(0, 1) + regexString.slice(2)

    if (regexString.charCodeAt(regexString.length - 2) === 36)
        regexString =
            regexString.slice(0, regexString.length - 2) +
            regexString.slice(regexString.length - 1)

    return regexString
}

export const getClosingParenthensePosition = (path: string, idx: number) => {
    // `path.indexOf()` will always return the first position of the closing parenthese,
    // but it's inefficient for grouped or wrong regexp expressions.
    // see issues #62 and #63 for more info

    var parentheses = 1

    while (idx < path.length) {
        idx++

        // ignore skipped chars
        if (path[idx] === '\\') {
            idx++
            continue
        }

        if (path[idx] === ')') parentheses--
        else if (path[idx] === '(') parentheses++

        if (!parentheses) return idx
    }

    throw new TypeError('Invalid regexp expression in "' + path + '"')
}
