const hostRegex = /^\w+:.*?(:)\d*/g
const paramsRegex = /([^?=&]+)(=([^&]*))?/g

export const parseUrl = (url: string) => {
	const [pathname, search] = url.replace(hostRegex, '').split('?')

	return [pathname, search]
}

export const parseQuery = (search: string) =>
	(search.match(paramsRegex) || []).reduce((result, each) => {
		const [key, value] = each.split('=')
		result[key] = value

		return result
	}, {} as Record<string, string>)
