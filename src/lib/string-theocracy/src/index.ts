import { parse as parseQueryString, type ParsedUrlQuery } from 'querystring'

import { removeDuplicateSlashes, removeHostnamePath, splitOnce } from './utils'

import type { Route, HTTPMethod, RouteResult, PlainRoute } from './types'

export type { Route, RouteResult, HTTPMethod } from './types'

const WILDCARD = Symbol('w')

const getNestedObject = (object: Object, props: string[]) =>
    props.reduce((a: any, c) => a[c], object)

export default class StringTheocracy<T = any> {
    routes: PlainRoute<T>[]
    #routes: Route
    #static: Record<string, T>

    #fallback?: any

    constructor() {
        this.routes = []
        this.#routes = {}
        this.#static = {}
    }

    default<Typed = T>(handle: T) {
        this.#fallback = handle

        return this
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

        return this
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

        const found = staticHandler ? true : !!handler
        // console.log("Static", !!staticHandler)

        return {
            found,
            method,
            path: parsedPath,
            handler: found ? handler : this.#fallback,
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
            let newCarry = Object.assign(carry, {
                [wildcard]: path
            })

            if (!rest[0]) return [route[wildcard], newCarry]
            return this.#find(route[wildcard] as Route, rest, newCarry)
        }

        if (!rest[0]) return [current, carry]

        return [current, carry]
    }

    off(method: HTTPMethod, path: string) {
        const parsedPath = removeDuplicateSlashes(removeHostnamePath(path))

        const index = this.routes.findIndex(
            (v) => v.path === path && v.method === method
        )
        if (index === -1) return

        this.routes.slice(index, 1)
        if (this.#static[parsedPath]) delete this.#static[parsedPath]

        const paths = [method, ...parsedPath.split('/')]
        paths.pop()

        while (paths.length) {
            let props: string[] = []
            paths.forEach((path) => props.push(path))

            if (Object.keys(getNestedObject(this.#routes, props)).length > 1)
                break

            this.#removeByKeys(this.#routes, props)
            paths.pop()
        }

        return this
    }

    #removeByKeys(obj: Object, keys: string[]) {
        const latest = keys.pop()

        if (!latest) return

        const target = getNestedObject(this.#routes, keys)

        if (Array.isArray(target)) target.splice(latest as any, 1)
        else delete target[latest]
    }

    reset() {
        this.routes = []
        this.#routes = {}
        this.#static = {}
    }
}

// const router = new StringTheocracy()

// router
//     .on('GET', '/id/:id', () => console.log('Hi'))
//     .on('GET', '/my/path', () => console.log('Hi'))
//     .on('GET', '/a/b/c', () => console.log('Hi'))
//     .on('GET', '/a/b//d', () => console.log('Hi'))
//     .on('GET', '/a/b/id/:id', () => console.log('Hi'))
//     .on('GET', '/a/b/id/:id/a', () => console.log('Hi'))

// console.log(router.routes)

// router.off('GET', '/a/b/c')
// router.off('GET', '/a/b/c')

// console.log('\n\n', router.find('GET', 'http://localhost:8080/id/1'))
// console.log(router.find('GET', '/id/:id'))
// console.log(router.find('GET', '/my/path'))
// console.log(router.find('GET', 'http://localhost:8080/a/b/c'))
// console.log(router.find('GET', '/a/b///d?awd=d&a=c'))
// console.log(router.find('GET', '/a/b/id/a/a?awd=d&a=c'))

// console.dir(router.route, {
//     depth: null
// })
