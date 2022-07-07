import { parse as parseQueryString } from 'querystring'
import isRegexSafe from 'safe-regex2'
import deepEqual from 'fast-deep-equal'

import {
    NODE_TYPES,
    RadixNode,
    ParentNode,
    StaticNode,
    NodeStack,
    WildcardNode,
    ParametricNode
} from './lib/custom-node'
import { safeDecodeURI, safeDecodeURIComponent } from './lib/url-sanitizer'
import {
    escapeRegExp,
    removeDuplicateSlashes,
    trimLastSlash,
    trimRegExpStartAndEnd,
    getClosingParenthensePosition,
    removeHostnamePath
} from './lib/utils'

import type { HTTPMethod, FindResult, Handler } from './lib/types'

const FULL_PATH_REGEXP = /^https?:\/\/.*?\//
const OPTIONAL_PARAM_REGEXP = /(\/:[^/()]*?)\?(\/?)/

interface RouterConfig {
    ignoreTrailingSlash?: boolean
    ignoreDuplicateSlashes?: boolean
    allowUnsafeRegex?: boolean
    caseSensitive?: boolean
    maxParamLength?: number
    defaultRoute?(req: Request): Response
    onBadUrl?(path: string, req: Request): Response
}

export default class Router {
    defaultRoute?: (request: Request) => Response
    onBadUrl?: (path: string, req: Request) => Response
    ignoreTrailingSlash: boolean
    ignoreDuplicateSlashes: boolean
    allowUnsafeRegex: boolean
    caseSensitive: boolean
    maxParamLength: number

    // ? Make `any[]` to make it play well with third party module
    // ? Like adding additional parameter to request
    routes: any[]
    trees: Record<
        string,
        StaticNode | ParentNode | ParametricNode | WildcardNode
    >
    _routesPatterns: any[]
    _cachedRoutes: Record<string, Handler>

    constructor({
        defaultRoute,
        onBadUrl,
        caseSensitive = true,
        ignoreDuplicateSlashes = false,
        ignoreTrailingSlash = false,
        maxParamLength = 100,
        allowUnsafeRegex = false
    }: RouterConfig = {}) {
        this.defaultRoute = defaultRoute
        this.onBadUrl = onBadUrl
        this.ignoreTrailingSlash = ignoreTrailingSlash
        this.ignoreDuplicateSlashes = ignoreDuplicateSlashes
        this.allowUnsafeRegex = allowUnsafeRegex
        this.caseSensitive = caseSensitive
        this.maxParamLength = maxParamLength

        this.routes = []
        this.trees = {}
        this._routesPatterns = []
        this._cachedRoutes = {}
    }

    on(method: HTTPMethod, path: string, handler: Handler, store?: any) {
        const optionalParamMatch = path.match(OPTIONAL_PARAM_REGEXP)
        if (optionalParamMatch) {
            const pathFull = path.replace(OPTIONAL_PARAM_REGEXP, '$1$2')
            const pathOptional = path.replace(OPTIONAL_PARAM_REGEXP, '$2')

            this.on(method, pathFull, handler, store)
            this.on(method, pathOptional, handler, store)
            return
        }

        if (this.ignoreDuplicateSlashes) path = removeDuplicateSlashes(path)
        if (this.ignoreTrailingSlash) path = trimLastSlash(path)

        const methods = Array.isArray(method) ? method : [method]

        for (const method of methods) {
            this._on(method, path, handler, store)
            this.routes.push({ method, path, handler, store })
        }
    }

    _on(method: HTTPMethod, path: string, handler: Handler, store: any) {
        if (this.trees[method] === undefined)
            this.trees[method] = new StaticNode('/')

        if (path === '*' && (this.trees[method] as StaticNode).prefix.length) {
            const currentRoot = this.trees[method]

            // @ts-ignore
            this.trees[method] = new StaticNode('')(
                this.trees[method] as StaticNode
            ).staticChildren['/'] = currentRoot
        }

        let currentNode = this.trees[method]

        let parentNodePathIndex =
            (currentNode as StaticNode)?.prefix?.length || undefined

        const params: string[] = []
        for (let i = 0; i <= path.length; i++) {
            if (path.charCodeAt(i) === 58 && path.charCodeAt(i + 1) === 58) {
                // It's a double colon
                i++
                continue
            }

            const isParametricNode =
                path.charCodeAt(i) === 58 && path.charCodeAt(i + 1) !== 58

            const isWildcardNode = path.charCodeAt(i) === 42

            if (
                isParametricNode ||
                isWildcardNode ||
                (i === path.length && i !== parentNodePathIndex)
            ) {
                let staticNodePath = path.slice(parentNodePathIndex, i)
                if (!this.caseSensitive)
                    staticNodePath = staticNodePath.toLowerCase()

                staticNodePath = staticNodePath
                    .split('::')
                    .join(':')
                    .split('%')
                    .join('%25')

                // add the static part of the route to the tree
                currentNode = (currentNode as ParametricNode).createStaticChild(
                    staticNodePath
                )
            }

            if (isParametricNode) {
                const regexps: string[] = []

                let staticEndingLength = 0
                let lastParamStartIndex = i + 1
                let isRegexNode = false

                for (let j = lastParamStartIndex; ; j++) {
                    const charCode = path.charCodeAt(j)

                    if (charCode === 40 || charCode === 45 || charCode === 46) {
                        isRegexNode = true

                        const paramName = path.slice(lastParamStartIndex, j)
                        params.push(paramName)

                        if (charCode !== 40) regexps.push('(.*?)')
                        else {
                            const endOfRegexIndex =
                                getClosingParenthensePosition(path, j)

                            const regexString = path.slice(
                                j,
                                endOfRegexIndex + 1
                            )

                            if (
                                !this.allowUnsafeRegex &&
                                isRegexSafe(new RegExp(regexString))
                            )
                                throw new Error(
                                    `The regex '${regexString}' is not safe!`
                                )

                            regexps.push(trimRegExpStartAndEnd(regexString))

                            j = endOfRegexIndex + 1
                        }

                        let lastParamEndIndex = j
                        for (
                            ;
                            lastParamEndIndex < path.length;
                            lastParamEndIndex++
                        ) {
                            const charCode = path.charCodeAt(lastParamEndIndex)

                            if (charCode === 58 || charCode === 47) break
                        }

                        const staticPart = path.slice(j, lastParamEndIndex)
                        if (staticPart) regexps.push(escapeRegExp(staticPart))

                        lastParamStartIndex = lastParamEndIndex + 1
                        j = lastParamEndIndex

                        if (path.charCodeAt(j) === 47 || j === path.length)
                            staticEndingLength = staticPart.length
                    } else if (charCode === 47 || j === path.length) {
                        const paramName = path.slice(lastParamStartIndex, j)
                        params.push(paramName)

                        if (regexps.length !== 0) regexps.push('(.*?)')
                    }

                    if (path.charCodeAt(j) === 47 || j === path.length) {
                        path =
                            path.slice(0, i + 1) +
                            path.slice(j - staticEndingLength)
                        i += staticEndingLength

                        break
                    }
                }

                let regex: RegExp | undefined = undefined
                if (isRegexNode)
                    regex = new RegExp('^' + regexps.join('') + '$')

                currentNode = (currentNode as StaticNode).createParametricChild(
                    regex
                )

                parentNodePathIndex = i + 1
            } else if (isWildcardNode) {
                // add the wildcard parameter
                params.push('*')
                currentNode = (currentNode as StaticNode).createWildcardChild()
                parentNodePathIndex = i + 1
            }
        }

        if (!this.caseSensitive) path = path.toLowerCase()

        for (const existRoute of this._routesPatterns)
            if (existRoute.path === path && existRoute.method === method)
                throw new Error(
                    `Method '${method}' already declared for route '${path}'`
                )

        this._routesPatterns.push({ method, path })

        currentNode.handlerStorage.addHandler(handler, params, store)
    }

    lookup(req: Request, store: Object = {}): Response {
        var handle = this.find(req.method as HTTPMethod, req.url)

        if (!handle) return this._defaultRoute(req)

        return handle.handler(req, handle.params, handle.searchParams, store)
    }

    find(method: HTTPMethod, path: string): FindResult | null {
        let currentNode = this.trees[method]

        if (!currentNode) return null

        // 47 is '/'
        path = removeHostnamePath(path)

        // This must be run before sanitizeUrl as the resulting function
        // .sliceParameter must be constructed with same URL string used
        // throughout the rest of this function.
        if (this.ignoreDuplicateSlashes) path = removeDuplicateSlashes(path)

        let sanitizedUrl
        let querystring
        let shouldDecodeParam

        try {
            sanitizedUrl = safeDecodeURI(path)
            path = sanitizedUrl.path
            querystring = sanitizedUrl.querystring
            shouldDecodeParam = sanitizedUrl.shouldDecodeParam
        } catch (error) {
            return this._onBadUrl(path)
        }

        if (this.ignoreTrailingSlash) path = trimLastSlash(path)

        const originPath = path

        if (this.caseSensitive === false) path = path.toLowerCase()

        const maxParamLength = this.maxParamLength

        let pathIndex = (currentNode as StaticNode).prefix.length
        const params: string[] = []
        const pathLen = path.length

        const brothersNodesStack: NodeStack[] = []

        while (true) {
            if (pathIndex === pathLen) {
                const handle = currentNode.handlerStorage.unconstrainedHandler

                if (handle !== null) {
                    return {
                        handler: handle.handler,
                        store: handle.store,
                        params: handle._createParamsObject(params),
                        searchParams: parseQueryString(querystring)
                    }
                }
            }

            let node = (currentNode as StaticNode).getNextNode(
                path,
                pathIndex,
                brothersNodesStack,
                params.length
            )

            if (node === null) {
                if (brothersNodesStack.length === 0) {
                    return null
                }

                const brotherNodeState = brothersNodesStack.pop()!
                pathIndex = brotherNodeState!.brotherPathIndex
                params.splice(brotherNodeState.paramsCount)
                node = brotherNodeState.brotherNode as WildcardNode
            }

            currentNode = node

            // static route
            if ((currentNode as StaticNode).kind === NODE_TYPES.STATIC) {
                pathIndex += (currentNode as StaticNode).prefix.length
                continue
            }

            if ((currentNode as WildcardNode).kind === NODE_TYPES.WILDCARD) {
                let param = originPath.slice(pathIndex)
                if (shouldDecodeParam) {
                    param = safeDecodeURIComponent(param)
                }

                params.push(param)
                pathIndex = pathLen
                continue
            }

            if (
                (currentNode as ParametricNode).kind === NODE_TYPES.PARAMETRIC
            ) {
                let paramEndIndex = originPath.indexOf('/', pathIndex)
                if (paramEndIndex === -1) paramEndIndex = pathLen

                let param = originPath.slice(pathIndex, paramEndIndex)
                if (shouldDecodeParam) param = safeDecodeURIComponent(param)

                if ((currentNode as ParametricNode).isRegex) {
                    const matchedParameters = (
                        currentNode as ParametricNode
                    ).regex?.exec(param)
                    if (!matchedParameters) continue

                    for (let i = 1; i < matchedParameters.length; i++) {
                        const matchedParam = matchedParameters[i]
                        if (matchedParam.length > maxParamLength) return null

                        params.push(matchedParam)
                    }
                } else {
                    if (param.length > maxParamLength) return null

                    params.push(param)
                }

                pathIndex = paramEndIndex
            }
        }
    }

    reset() {
        this.trees = {}
        this.routes = []
        this._routesPatterns = []
    }

    off(method: HTTPMethod, path: string) {
        if (path[0] === '/' || path[0] === '*')
            throw new Error(
                'The first character of a path should be `/` or `*`'
            )

        // path ends with optional parameter
        const optionalParamMatch = path.match(OPTIONAL_PARAM_REGEXP)

        if (optionalParamMatch) {
            if (
                path.length ===
                optionalParamMatch.index! + optionalParamMatch[0].length
            )
                throw new Error(
                    'Optional Parameter needs to be the last parameter of the path'
                )

            const pathFull = path.replace(OPTIONAL_PARAM_REGEXP, '$1$2')
            const pathOptional = path.replace(OPTIONAL_PARAM_REGEXP, '$2')

            this.off(method, pathFull)
            this.off(method, pathOptional)
            return
        }

        if (this.ignoreDuplicateSlashes) path = removeDuplicateSlashes(path)

        if (this.ignoreTrailingSlash) path = trimLastSlash(path)

        const methods = Array.isArray(method) ? method : [method]
        for (const method of methods) this._off(method, path)
    }

    _off(method: HTTPMethod, path: string) {
        const newRoutes = this.routes.filter(
            (route) => method !== route.method || path !== route.path
        )

        this._rebuild(newRoutes)
    }

    _rebuild(routes: typeof this.routes) {
        this.reset()

        for (const route of routes) {
            const { method, path, handler, store } = route
            this._on(method, path, handler, store)
            this.routes.push({ method, path, handler, store })
        }
    }

    _defaultRoute(request: Request) {
        if (!this.defaultRoute)
            return new Response(undefined, {
                status: 404
            })

        return this.defaultRoute(request)
    }

    _onBadUrl(path: string): FindResult | null {
        if (!this.onBadUrl) return null

        const onBadUrl = this.onBadUrl

        return {
            handler: (req, ctx) => onBadUrl(path, req),
            params: {},
            store: null
        }
    }
}

export type { Handler, HTTPMethod } from './lib/types'
export type { ParsedUrlQuery } from 'querystring'
