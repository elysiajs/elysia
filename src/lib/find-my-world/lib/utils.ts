export const removeHostnamePath = (path: string) => {
    if (path.charCodeAt(0) === 47) return path

    const total = path.length

    let i = 1
    let point = 0

    for (; i < total; i++) {
        if (path.charCodeAt(i) === 47)
            if (point < 2) point++
            else break
    }

    return path.slice(i)
}

export const escapeRegExp = (value: string) =>
    value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const removeDuplicateSlashes = (path: string) => {
    let newPath = ''
    let flip = false

    for (let i = 0; i < path.length; i++) {
        if (path.charCodeAt(i) === 47) {
            if (!flip) {
                flip = true
                newPath += path[i]
            }
        } else {
            flip = false
            if (!flip) newPath += path[i]
        }
    }

    return newPath
}

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
