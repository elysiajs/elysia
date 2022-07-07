// const SLASH = 47

export const removeHostnamePath = (path: string) => {
    if (path.charCodeAt(0) === 47) return path

    const total = path.length

    let i = 1
    let point = 0

    for (; i < total; i++)
        if (path.charCodeAt(i) === 47)
            if (point < 2) point++
            else break

    return path.slice(i)
}

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

export const splitOnce = (delimiter: string, s: string) => {
    const i = s.indexOf(delimiter)

    if (i === -1) return [s, '']

    return [s.slice(0, i), s.slice(i + 1)]
}
