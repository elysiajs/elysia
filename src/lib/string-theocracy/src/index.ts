import { parse as parseQueryString, type ParsedUrlQuery } from 'querystring'

import { removeDuplicateSlashes, removeHostnamePath, splitOnce } from './utils'

import type { Route, HTTPMethod, RouteResult, PlainRoute } from './types'

const WILDCARD = Symbol('w')

export type { Route, RouteResult, HTTPMethod } from './types'

export default class StringTheocracy<T = Function> {
    routes: PlainRoute<T>[]
    #routes: Route
    #static: Record<string, T>

    constructor() {
        this.routes = []
        this.#routes = {}
        this.#static = {}
    }

    on(method: HTTPMethod, path: string, handler: T) {
        const parsedPath = removeDuplicateSlashes(removeHostnamePath(path))

        if (!this.#routes[method]) this.#routes[method] = {}

        this.routes.push({
            method,
            path,
            handler
        })

        if (!parsedPath.includes(':')) this.#static[parsedPath] = handler

        this.#on(this.#routes[method] as Route, parsedPath.split('/'), handler)
    }

    #on(route: Route, [path, ...routes]: string[], handler: T) {
        if (!route[path])
            if (path.charCodeAt(0) === 58) {
                // Colon
                path = path.slice(1, path.length)
                route[WILDCARD] = path
            } else route[path] = {}

        if (routes[0]) this.#on(route[path] as Route, routes, handler)
        else route[path] = handler
    }

    find(method: HTTPMethod, path: string): RouteResult<T> {
        const [restPath, query] = splitOnce('?', path)

        const parsedPath = removeDuplicateSlashes(removeHostnamePath(restPath))
        const staticHandler = this.#static[parsedPath]

        const [handler, params] = staticHandler
            ? [staticHandler, {}]
            : this.#find(this.#routes[method] as Route, parsedPath.split('/'))

        const found = staticHandler ? true : typeof handler === 'function'

        return {
            found,
            method,
            path: restPath,
            handler: found ? handler : undefined,
            params,
            query: query ? parseQueryString(query) : {}
        }
    }

    #find(
        route: Route,
        [path, ...rest]: string[],
        carry: Record<string, string> = {}
    ): [any, RouteResult['params']] {
        const current = route[path]

        if (current && rest[0]) return this.#find(current as Route, rest, carry)

        const wildcard = route[WILDCARD] as string | undefined
        if (wildcard) {
            if (!rest[0]) return [route[wildcard], carry]

            return this.#find(
                route[wildcard] as Route,
                rest,
                Object.assign(carry, {
                    [wildcard]: path
                })
            )
        }

        if (!rest[0]) return [current, carry]

        return [current, carry]
    }

    get dev() {
        return this.#static
    }

    reset() {
        this.#routes = {}
        this.routes = []
    }
}

const router = new StringTheocracy()

// router.on('GET', '/', () => console.log('Hi'))
// router.on('GET', '/my/path', () => console.log('Hi'))
// router.on('GET', '/a/b/c', () => console.log('Hi'))
// router.on('GET', '/a/b//d', () => console.log('Hi'))
// router.on('GET', '/a/b/id/:id', () => console.log('Hi'))
// router.on('GET', '/a/b/id/:id/a', () => console.log('Hi'))

// console.log(router.dev)

// console.log(router.find('GET', '/'))
// console.log(router.find('GET', '/my/path'))
// console.log(router.find('GET', 'http://localhost:8080/a/b/c'))
// console.log(router.find('GET', '/a/b///d?awd=d&a=c'))
// console.log(router.find('GET', '/a/b/id/a/a?awd=d&a=c'))

// console.dir(router.route, {
//     depth: null
// })
