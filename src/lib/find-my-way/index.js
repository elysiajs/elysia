'use strict'

/*
  Char codes:
    '!': 33 - !
    '#': 35 - %23
    '$': 36 - %24
    '%': 37 - %25
    '&': 38 - %26
    ''': 39 - '
    '(': 40 - (
    ')': 41 - )
    '*': 42 - *
    '+': 43 - %2B
    ',': 44 - %2C
    '-': 45 - -
    '.': 46 - .
    '/': 47 - %2F
    ':': 58 - %3A
    ';': 59 - %3B
    '=': 61 - %3D
    '?': 63 - %3F
    '@': 64 - %40
    '_': 95 - _
    '~': 126 - ~
*/

function assert(condition, warning) {
  if(condition) return new Error(warning)
}

const http = require('http')
const querystring = require('querystring')
const isRegexSafe = require('safe-regex2')
const deepEqual = require('fast-deep-equal')
const { flattenNode, compressFlattenedNode, prettyPrintFlattenedNode, prettyPrintRoutesArray } = require('./lib/pretty-print')
const { StaticNode, NODE_TYPES } = require('./custom_node')
const Constrainer = require('./lib/constrainer')
const { safeDecodeURI, safeDecodeURIComponent } = require('./lib/url-sanitizer')

const httpMethods = http.METHODS
const FULL_PATH_REGEXP = /^https?:\/\/.*?\//
const OPTIONAL_PARAM_REGEXP = /(\/:[^/()]*?)\?(\/?)/

if (!isRegexSafe(FULL_PATH_REGEXP)) {
  throw new Error('the FULL_PATH_REGEXP is not safe, update this module')
}

if (!isRegexSafe(OPTIONAL_PARAM_REGEXP)) {
  throw new Error('the OPTIONAL_PARAM_REGEXP is not safe, update this module')
}

function Router (opts) {
  if (!(this instanceof Router)) {
    return new Router(opts)
  }
  opts = opts || {}

  if (opts.defaultRoute) {
    assert(typeof opts.defaultRoute === 'function', 'The default route must be a function')
    this.defaultRoute = opts.defaultRoute
  } else {
    this.defaultRoute = null
  }

  if (opts.onBadUrl) {
    assert(typeof opts.onBadUrl === 'function', 'The bad url handler must be a function')
    this.onBadUrl = opts.onBadUrl
  } else {
    this.onBadUrl = null
  }

  if (opts.buildPrettyMeta) {
    assert(typeof opts.buildPrettyMeta === 'function', 'buildPrettyMeta must be a function')
    this.buildPrettyMeta = opts.buildPrettyMeta
  } else {
    this.buildPrettyMeta = defaultBuildPrettyMeta
  }

  if (opts.querystringParser) {
    assert(typeof opts.querystringParser === 'function', 'querystringParser must be a function')
    this.querystringParser = opts.querystringParser
  } else {
    this.querystringParser = (query) => query === '' ? {} : querystring.parse(query)
  }

  this.caseSensitive = opts.caseSensitive === undefined ? true : opts.caseSensitive
  this.ignoreTrailingSlash = opts.ignoreTrailingSlash || false
  this.ignoreDuplicateSlashes = opts.ignoreDuplicateSlashes || false
  this.maxParamLength = opts.maxParamLength || 100
  this.allowUnsafeRegex = opts.allowUnsafeRegex || false
  this.routes = []
  this.trees = {}
  this.constrainer = new Constrainer(opts.constraints)

  this._routesPatterns = []
}

Router.prototype.on = function on (method, path, opts, handler, store) {
  if (typeof opts === 'function') {
    if (handler !== undefined) {
      store = handler
    }
    handler = opts
    opts = {}
  }
  // path validation
  assert(typeof path === 'string', 'Path should be a string')
  assert(path.length > 0, 'The path could not be empty')
  assert(path[0] === '/' || path[0] === '*', 'The first character of a path should be `/` or `*`')
  // handler validation
  assert(typeof handler === 'function', 'Handler should be a function')

  // path ends with optional parameter
  const optionalParamMatch = path.match(OPTIONAL_PARAM_REGEXP)
  if (optionalParamMatch) {
    assert(path.length === optionalParamMatch.index + optionalParamMatch[0].length, 'Optional Parameter needs to be the last parameter of the path')

    const pathFull = path.replace(OPTIONAL_PARAM_REGEXP, '$1$2')
    const pathOptional = path.replace(OPTIONAL_PARAM_REGEXP, '$2')

    this.on(method, pathFull, opts, handler, store)
    this.on(method, pathOptional, opts, handler, store)
    return
  }

  const route = path

  if (this.ignoreDuplicateSlashes) {
    path = removeDuplicateSlashes(path)
  }

  if (this.ignoreTrailingSlash) {
    path = trimLastSlash(path)
  }

  const methods = Array.isArray(method) ? method : [method]
  for (const method of methods) {
    this._on(method, path, opts, handler, store, route)
    this.routes.push({ method, path, opts, handler, store })
  }
}

Router.prototype._on = function _on (method, path, opts, handler, store) {
  assert(typeof method === 'string', 'Method should be a string')
  assert(httpMethods.includes(method), `Method '${method}' is not an http method.`)

  let constraints = {}
  if (opts.constraints !== undefined) {
    assert(typeof opts.constraints === 'object' && opts.constraints !== null, 'Constraints should be an object')
    if (Object.keys(opts.constraints).length !== 0) {
      constraints = opts.constraints
    }
  }

  this.constrainer.validateConstraints(constraints)
  // Let the constrainer know if any constraints are being used now
  this.constrainer.noteUsage(constraints)

  // Boot the tree for this method if it doesn't exist yet
  if (this.trees[method] === undefined) {
    this.trees[method] = new StaticNode('/')
  }

  if (path === '*' && this.trees[method].prefix.length !== 0) {
    const currentRoot = this.trees[method]
    this.trees[method] = new StaticNode('')
    this.trees[method].staticChildren['/'] = currentRoot
  }

  let currentNode = this.trees[method]
  let parentNodePathIndex = currentNode.prefix.length

  const params = []
  for (let i = 0; i <= path.length; i++) {
    if (path.charCodeAt(i) === 58 && path.charCodeAt(i + 1) === 58) {
      // It's a double colon
      i++
      continue
    }

    const isParametricNode = path.charCodeAt(i) === 58 && path.charCodeAt(i + 1) !== 58
    const isWildcardNode = path.charCodeAt(i) === 42

    if (isParametricNode || isWildcardNode || (i === path.length && i !== parentNodePathIndex)) {
      let staticNodePath = path.slice(parentNodePathIndex, i)
      if (!this.caseSensitive) {
        staticNodePath = staticNodePath.toLowerCase()
      }
      staticNodePath = staticNodePath.split('::').join(':')
      staticNodePath = staticNodePath.split('%').join('%25')
      // add the static part of the route to the tree
      currentNode = currentNode.createStaticChild(staticNodePath)
    }

    if (isParametricNode) {
      let isRegexNode = false
      const regexps = []

      let staticEndingLength = 0
      let lastParamStartIndex = i + 1
      for (let j = lastParamStartIndex; ; j++) {
        const charCode = path.charCodeAt(j)

        if (charCode === 40 || charCode === 45 || charCode === 46) {
          isRegexNode = true

          const paramName = path.slice(lastParamStartIndex, j)
          params.push(paramName)

          if (charCode === 40) {
            const endOfRegexIndex = getClosingParenthensePosition(path, j)
            const regexString = path.slice(j, endOfRegexIndex + 1)

            if (!this.allowUnsafeRegex) {
              assert(isRegexSafe(new RegExp(regexString)), `The regex '${regexString}' is not safe!`)
            }

            regexps.push(trimRegExpStartAndEnd(regexString))

            j = endOfRegexIndex + 1
          } else {
            regexps.push('(.*?)')
          }

          let lastParamEndIndex = j
          for (; lastParamEndIndex < path.length; lastParamEndIndex++) {
            const charCode = path.charCodeAt(lastParamEndIndex)
            if (charCode === 58 || charCode === 47) {
              break
            }
          }

          const staticPart = path.slice(j, lastParamEndIndex)
          if (staticPart) {
            regexps.push(escapeRegExp(staticPart))
          }

          lastParamStartIndex = lastParamEndIndex + 1
          j = lastParamEndIndex

          if (path.charCodeAt(j) === 47 || j === path.length) {
            staticEndingLength = staticPart.length
          }
        } else if (charCode === 47 || j === path.length) {
          const paramName = path.slice(lastParamStartIndex, j)
          params.push(paramName)

          if (regexps.length !== 0) {
            regexps.push('(.*?)')
          }
        }

        if (path.charCodeAt(j) === 47 || j === path.length) {
          path = path.slice(0, i + 1) + path.slice(j - staticEndingLength)
          i += staticEndingLength
          break
        }
      }

      let regex = null
      if (isRegexNode) {
        regex = new RegExp('^' + regexps.join('') + '$')
      }

      currentNode = currentNode.createParametricChild(regex)
      parentNodePathIndex = i + 1
    } else if (isWildcardNode) {
      // add the wildcard parameter
      params.push('*')
      currentNode = currentNode.createWildcardChild()
      parentNodePathIndex = i + 1
    }
  }

  if (!this.caseSensitive) {
    path = path.toLowerCase()
  }

  for (const existRoute of this._routesPatterns) {
    if (
      existRoute.path === path &&
      existRoute.method === method &&
      deepEqual(existRoute.constraints, constraints)
    ) {
      throw new Error(`Method '${method}' already declared for route '${path}' with constraints '${JSON.stringify(constraints)}'`)
    }
  }
  this._routesPatterns.push({ method, path, constraints })

  currentNode.handlerStorage.addHandler(handler, params, store, this.constrainer, constraints)
}

Router.prototype.hasConstraintStrategy = function (strategyName) {
  return this.constrainer.hasConstraintStrategy(strategyName)
}

Router.prototype.addConstraintStrategy = function (constraints) {
  this.constrainer.addConstraintStrategy(constraints)
  this._rebuild(this.routes)
}

Router.prototype.reset = function reset () {
  this.trees = {}
  this.routes = []
  this._routesPatterns = []
}

Router.prototype.off = function off (method, path, opts) {
  // path validation
  assert(typeof path === 'string', 'Path should be a string')
  assert(path.length > 0, 'The path could not be empty')
  assert(path[0] === '/' || path[0] === '*', 'The first character of a path should be `/` or `*`')

  // path ends with optional parameter
  const optionalParamMatch = path.match(OPTIONAL_PARAM_REGEXP)
  if (optionalParamMatch) {
    assert(path.length === optionalParamMatch.index + optionalParamMatch[0].length, 'Optional Parameter needs to be the last parameter of the path')

    const pathFull = path.replace(OPTIONAL_PARAM_REGEXP, '$1$2')
    const pathOptional = path.replace(OPTIONAL_PARAM_REGEXP, '$2')

    this.off(method, pathFull, opts)
    this.off(method, pathOptional, opts)
    return
  }

  if (this.ignoreDuplicateSlashes) {
    path = removeDuplicateSlashes(path)
  }

  if (this.ignoreTrailingSlash) {
    path = trimLastSlash(path)
  }

  const methods = Array.isArray(method) ? method : [method]
  for (const method of methods) {
    this._off(method, path, opts)
  }
}

Router.prototype._off = function _off (method, path, opts) {
  // method validation
  assert(typeof method === 'string', 'Method should be a string')
  assert(httpMethods.includes(method), `Method '${method}' is not an http method.`)

  function matcher (currentConstraints) {
    if (!opts || !currentConstraints) return true

    return deepEqual(opts, currentConstraints)
  }

  // Rebuild tree without the specific route
  const newRoutes = this.routes.filter((route) => method !== route.method || path !== route.path || !matcher(route.opts.constraints))
  this._rebuild(newRoutes)
}

Router.prototype.lookup = function lookup (req, ctx) {
  var handle = this.find(req.method, req.url, this.constrainer.deriveConstraints(req, ctx))
  if (handle === null) return this._defaultRoute(req, ctx)
  return ctx === undefined
    ? handle.handler(req, handle.params, handle.store, handle.searchParams)
    : handle.handler.call(ctx, req, handle.params, handle.store, handle.searchParams)
}

Router.prototype.find = function find (method, path, derivedConstraints) {
  let currentNode = this.trees[method]
  if (currentNode === undefined) return null

  if (path.charCodeAt(0) !== 47) { // 47 is '/'
    path = path.replace(FULL_PATH_REGEXP, '/')
  }

  // This must be run before sanitizeUrl as the resulting function
  // .sliceParameter must be constructed with same URL string used
  // throughout the rest of this function.
  if (this.ignoreDuplicateSlashes) {
    path = removeDuplicateSlashes(path)
  }

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

  if (this.ignoreTrailingSlash) {
    path = trimLastSlash(path)
  }

  const originPath = path

  if (this.caseSensitive === false) {
    path = path.toLowerCase()
  }

  const maxParamLength = this.maxParamLength

  let pathIndex = currentNode.prefix.length
  const params = []
  const pathLen = path.length

  const brothersNodesStack = []

  while (true) {
    if (pathIndex === pathLen) {
      const handle = currentNode.handlerStorage.getMatchingHandler(derivedConstraints)

      if (handle !== null) {
        return {
          handler: handle.handler,
          store: handle.store,
          params: handle._createParamsObject(params),
          searchParams: this.querystringParser(querystring)
        }
      }
    }

    let node = currentNode.getNextNode(path, pathIndex, brothersNodesStack, params.length)

    if (node === null) {
      if (brothersNodesStack.length === 0) {
        return null
      }

      const brotherNodeState = brothersNodesStack.pop()
      pathIndex = brotherNodeState.brotherPathIndex
      params.splice(brotherNodeState.paramsCount)
      node = brotherNodeState.brotherNode
    }

    currentNode = node

    // static route
    if (currentNode.kind === NODE_TYPES.STATIC) {
      pathIndex += currentNode.prefix.length
      continue
    }

    if (currentNode.kind === NODE_TYPES.WILDCARD) {
      let param = originPath.slice(pathIndex)
      if (shouldDecodeParam) {
        param = safeDecodeURIComponent(param)
      }

      params.push(param)
      pathIndex = pathLen
      continue
    }

    if (currentNode.kind === NODE_TYPES.PARAMETRIC) {
      let paramEndIndex = originPath.indexOf('/', pathIndex)
      if (paramEndIndex === -1) {
        paramEndIndex = pathLen
      }

      let param = originPath.slice(pathIndex, paramEndIndex)
      if (shouldDecodeParam) {
        param = safeDecodeURIComponent(param)
      }

      if (currentNode.isRegex) {
        const matchedParameters = currentNode.regex.exec(param)
        if (matchedParameters === null) continue

        for (let i = 1; i < matchedParameters.length; i++) {
          const matchedParam = matchedParameters[i]
          if (matchedParam.length > maxParamLength) {
            return null
          }
          params.push(matchedParam)
        }
      } else {
        if (param.length > maxParamLength) {
          return null
        }
        params.push(param)
      }

      pathIndex = paramEndIndex
    }
  }
}

Router.prototype._rebuild = function (routes) {
  this.reset()

  for (const route of routes) {
    const { method, path, opts, handler, store } = route
    this._on(method, path, opts, handler, store)
    this.routes.push({ method, path, opts, handler, store })
  }
}

Router.prototype._defaultRoute = function (req, ctx) {
  if (this.defaultRoute !== null) {
    return ctx === undefined
      ? this.defaultRoute(req)
      : this.defaultRoute.call(ctx, req)
  } else {
      return new Response(undefined, {
        status: 404
      })
  }
}

Router.prototype._onBadUrl = function (path) {
  if (this.onBadUrl === null) {
    return null
  }
  const onBadUrl = this.onBadUrl
  return {
    handler: (req, ctx) => onBadUrl(path, req),
    params: {},
    store: null
  }
}

Router.prototype.prettyPrint = function (opts = {}) {
  opts.commonPrefix = opts.commonPrefix === undefined ? true : opts.commonPrefix // default to original behaviour
  if (!opts.commonPrefix) return prettyPrintRoutesArray.call(this, this.routes, opts)
  const root = {
    prefix: '/',
    nodes: [],
    children: {}
  }

  for (const method in this.trees) {
    const node = this.trees[method]
    if (node) {
      flattenNode(root, node, method)
    }
  }

  compressFlattenedNode(root)

  return prettyPrintFlattenedNode.call(this, root, '', true, opts)
}

for (var i in http.METHODS) {
  /* eslint no-prototype-builtins: "off" */
  if (!http.METHODS.hasOwnProperty(i)) continue
  const m = http.METHODS[i]
  const methodName = m.toLowerCase()

  if (Router.prototype[methodName]) throw new Error('Method already exists: ' + methodName)

  Router.prototype[methodName] = function (path, handler, store) {
    return this.on(m, path, handler, store)
  }
}

Router.prototype.all = function (path, handler, store) {
  this.on(httpMethods, path, handler, store)
}

module.exports = Router

function escapeRegExp (string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function removeDuplicateSlashes (path) {
  return path.replace(/\/\/+/g, '/')
}

function trimLastSlash (path) {
  if (path.length > 1 && path.charCodeAt(path.length - 1) === 47) {
    return path.slice(0, -1)
  }
  return path
}

function trimRegExpStartAndEnd (regexString) {
  // removes chars that marks start "^" and end "$" of regexp
  if (regexString.charCodeAt(1) === 94) {
    regexString = regexString.slice(0, 1) + regexString.slice(2)
  }

  if (regexString.charCodeAt(regexString.length - 2) === 36) {
    regexString = regexString.slice(0, regexString.length - 2) + regexString.slice(regexString.length - 1)
  }

  return regexString
}

function getClosingParenthensePosition (path, idx) {
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

    if (path[idx] === ')') {
      parentheses--
    } else if (path[idx] === '(') {
      parentheses++
    }

    if (!parentheses) return idx
  }

  throw new TypeError('Invalid regexp expression in "' + path + '"')
}

function defaultBuildPrettyMeta (route) {
  // buildPrettyMeta function must return an object, which will be parsed into key/value pairs for display
  if (!route) return {}
  if (!route.store) return {}
  return Object.assign({}, route.store)
}
