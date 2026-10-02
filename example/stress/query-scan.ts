// A/B harness for the duplicated query-scanner (src/parse-query.ts). The
// per-request parser inlines its scanner + processKeyValuePair as a local
// closure per function; a shared scanner would pass a megamorphic callback.
import { parseQueryFromURL, parseQuery } from '../../src/parse-query'
import { run, bench, summary } from 'mitata'

const url = 'http://e.ly/search?page=2&limit=20&q=hello+world&name=saltyaom'
const qi = url.indexOf('?')
const qs = 'page=2&limit=20&q=hello+world&name=saltyaom'

// a heavier, decode-and-plus case
const url2 = 'http://e.ly/x?a=1&b=two&c=a%20b%20c&d=x+y+z&e=hello&f=world&g=42'
const qi2 = url2.indexOf('?')
const qs2 = 'a=1&b=two&c=a%20b%20c&d=x+y+z&e=hello&f=world&g=42'

for (let i = 0; i < 5000; i++) {
	parseQueryFromURL(url, qi)
	parseQuery(qs)
	parseQueryFromURL(url2, qi2)
	parseQuery(qs2)
}

summary(() => {
	bench('parseQueryFromURL (4 pairs)', () => parseQueryFromURL(url, qi))
	bench('parseQuery (4 pairs)', () => parseQuery(qs))
	bench('parseQueryFromURL (7 pairs +decode)', () => parseQueryFromURL(url2, qi2))
	bench('parseQuery (7 pairs +decode)', () => parseQuery(qs2))
})

await run()
