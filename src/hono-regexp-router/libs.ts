const hostRegex = /^\w+:\/\/.*?\//g
const paramsRegex = /([^?=&]+)(=([^&]*))?/g

const SLASH = 47

export const parseUrl = (url: string) => {
    if (url.charCodeAt(0) !== SLASH) url = url.replace(hostRegex, '/')

    return url.replace(hostRegex, '/').split('?')
}

export const parseQuery = (search: string) =>
    (search.match(paramsRegex) || []).reduce((result, each) => {
        const [key, value] = each.split('=')
        result[key] = value

        return result
    }, {} as Record<string, string>)
