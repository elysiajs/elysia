'use strict'

/* eslint-disable no-multi-spaces */
const indent              = '    '
const branchIndent        = '│   '
const midBranchIndent     = '├── '
const endBranchIndent     = '└── '
const wildcardDelimiter   = '*'
const pathDelimiter       = '/'
const pathRegExp          = /(?=\/)/
/* eslint-enable */

function parseFunctionName (fn) {
  let fName = fn.name || ''

  fName = fName.replace('bound', '').trim()
  fName = (fName || 'anonymous') + '()'
  return fName
}

function parseMeta (meta) {
  if (Array.isArray(meta)) return meta.map(m => parseMeta(m))
  if (typeof meta === 'symbol') return meta.toString()
  if (typeof meta === 'function') return parseFunctionName(meta)
  return meta
}

function buildMetaObject (route, metaArray) {
  const out = {}
  const cleanMeta = this.buildPrettyMeta(route)
  if (!Array.isArray(metaArray)) metaArray = cleanMeta ? Reflect.ownKeys(cleanMeta) : []
  metaArray.forEach(m => {
    const metaKey = typeof m === 'symbol' ? m.toString() : m
    if (cleanMeta && cleanMeta[m]) {
      out[metaKey] = parseMeta(cleanMeta[m])
    }
  })
  return out
}

function prettyPrintRoutesArray (routeArray, opts = {}) {
  if (!this.buildPrettyMeta) throw new Error('buildPrettyMeta not defined')
  opts.includeMeta = opts.includeMeta || null // array of meta objects to display
  const mergedRouteArray = []

  let tree = ''

  routeArray.sort((a, b) => {
    if (!a.path || !b.path) return 0
    return a.path.localeCompare(b.path)
  })

  // merge alike paths
  for (let i = 0; i < routeArray.length; i++) {
    const route = routeArray[i]
    const pathExists = mergedRouteArray.find(r => route.path === r.path)
    if (pathExists) {
      // path already declared, add new method and break out of loop
      pathExists.handlers.push({
        method: route.method,
        opts: route.opts.constraints || undefined,
        meta: opts.includeMeta ? buildMetaObject.call(this, route, opts.includeMeta) : null
      })
      continue
    }

    const routeHandler = {
      method: route.method,
      opts: route.opts.constraints || undefined,
      meta: opts.includeMeta ? buildMetaObject.call(this, route, opts.includeMeta) : null
    }
    mergedRouteArray.push({
      path: route.path,
      methods: [route.method],
      opts: [route.opts],
      handlers: [routeHandler]
    })
  }

  // insert root level path if none defined
  if (!mergedRouteArray.filter(r => r.path === pathDelimiter).length) {
    const rootPath = {
      path: pathDelimiter,
      truncatedPath: '',
      methods: [],
      opts: [],
      handlers: [{}]
    }

    // if wildcard route exists, insert root level after wildcard
    if (mergedRouteArray.filter(r => r.path === wildcardDelimiter).length) {
      mergedRouteArray.splice(1, 0, rootPath)
    } else {
      mergedRouteArray.unshift(rootPath)
    }
  }

  // build tree
  const routeTree = buildRouteTree(mergedRouteArray)

  // draw tree
  routeTree.forEach((rootBranch, idx) => {
    tree += drawBranch(rootBranch, null, idx === routeTree.length - 1, false, true)
    tree += '\n' // newline characters inserted at beginning of drawing function to allow for nested paths
  })

  return tree
}

function buildRouteTree (mergedRouteArray) {
  const result = []
  const temp = { result }
  mergedRouteArray.forEach((route, idx) => {
    let splitPath = route.path.split(pathRegExp)

    // add preceding slash for proper nesting
    if (splitPath[0] !== pathDelimiter) {
      // handle wildcard route
      if (splitPath[0] !== wildcardDelimiter) splitPath = [pathDelimiter, splitPath[0].slice(1), ...splitPath.slice(1)]
    }

    // build tree
    splitPath.reduce((acc, path, pidx) => {
      if (!acc[path]) {
        acc[path] = { result: [] }
        const pathSeg = { path, children: acc[path].result }

        if (pidx === splitPath.length - 1) pathSeg.handlers = route.handlers
        acc.result.push(pathSeg)
      }
      return acc[path]
    }, temp)
  })

  // unfold root object from array
  return result
}

function drawBranch (pathSeg, prefix, endBranch, noPrefix, rootBranch) {
  let branch = ''

  if (!noPrefix && !rootBranch) branch += '\n'
  if (!noPrefix) branch += `${prefix || ''}${endBranch ? endBranchIndent : midBranchIndent}`
  branch += `${pathSeg.path}`

  if (pathSeg.handlers) {
    const flatHandlers = pathSeg.handlers.reduce((acc, curr) => {
      const match = acc.findIndex(h => JSON.stringify(h.opts) === JSON.stringify(curr.opts))
      if (match !== -1) {
        acc[match].method = [acc[match].method, curr.method].join(', ')
      } else {
        acc.push(curr)
      }
      return acc
    }, [])

    flatHandlers.forEach((handler, idx) => {
      if (idx > 0) branch += `${noPrefix ? '' : prefix || ''}${endBranch ? indent : branchIndent}${pathSeg.path}`
      branch += ` (${handler.method || '-'})`
      if (handler.opts && JSON.stringify(handler.opts) !== '{}') branch += ` ${JSON.stringify(handler.opts)}`
      if (handler.meta) {
        Reflect.ownKeys(handler.meta).forEach((m, hidx) => {
          branch += `\n${noPrefix ? '' : prefix || ''}${endBranch ? indent : branchIndent}`
          branch += `• (${m}) ${JSON.stringify(handler.meta[m])}`
        })
      }
      if (flatHandlers.length > 1 && idx !== flatHandlers.length - 1) branch += '\n'
    })
  } else {
    if (pathSeg.children.length > 1) branch += ' (-)'
  }

  if (!noPrefix) prefix = `${prefix || ''}${endBranch ? indent : branchIndent}`

  pathSeg.children.forEach((child, idx) => {
    const endBranch = idx === pathSeg.children.length - 1
    const skipPrefix = (!pathSeg.handlers && pathSeg.children.length === 1)
    branch += drawBranch(child, prefix, endBranch, skipPrefix)
  })

  return branch
}

function prettyPrintFlattenedNode (flattenedNode, prefix, tail, opts) {
  if (!this.buildPrettyMeta) throw new Error('buildPrettyMeta not defined')
  opts.includeMeta = opts.includeMeta || null // array of meta items to display
  let paramName = ''
  const printHandlers = []

  for (const { node, method } of flattenedNode.nodes) {
    for (const handler of node.handlerStorage.handlers) {
      printHandlers.push({ method, ...handler })
    }
  }

  if (printHandlers.length) {
    printHandlers.forEach((handler, index) => {
      let suffix = `(${handler.method || '-'})`
      if (Object.keys(handler.constraints).length > 0) {
        suffix += ' ' + JSON.stringify(handler.constraints)
      }

      let name = ''
      // find locations of parameters in prefix
      const paramIndices = flattenedNode.prefix.split('').map((ch, idx) => ch === ':' ? idx : null).filter(idx => idx !== null)
      if (paramIndices.length) {
        let prevLoc = 0
        paramIndices.forEach((loc, idx) => {
          // find parameter in prefix
          name += flattenedNode.prefix.slice(prevLoc, loc + 1)
          // insert parameters
          name += handler.params[handler.params.length - paramIndices.length + idx]
          if (idx === paramIndices.length - 1) name += flattenedNode.prefix.slice(loc + 1)
          prevLoc = loc + 1
        })
      } else {
        // there are no parameters, return full object
        name = flattenedNode.prefix
      }

      if (index === 0) {
        paramName += `${name} ${suffix}`
      } else {
        paramName += `\n${prefix}${tail ? indent : branchIndent}${name} ${suffix}`
      }
      if (opts.includeMeta) {
        const meta = buildMetaObject.call(this, handler, opts.includeMeta)
        Object.keys(meta).forEach((m, hidx) => {
          paramName += `\n${prefix || ''}${tail ? indent : branchIndent}`
          paramName += `• (${m}) ${JSON.stringify(meta[m])}`
        })
      }
    })
  } else {
    paramName = flattenedNode.prefix
  }

  let tree = `${prefix}${tail ? endBranchIndent : midBranchIndent}${paramName}\n`

  prefix = `${prefix}${tail ? indent : branchIndent}`
  const labels = Object.keys(flattenedNode.children)
  for (let i = 0; i < labels.length; i++) {
    const child = flattenedNode.children[labels[i]]
    tree += prettyPrintFlattenedNode.call(this, child, prefix, i === (labels.length - 1), opts)
  }
  return tree
}

function flattenNode (flattened, node, method) {
  if (node.handlerStorage.handlers.length !== 0) {
    flattened.nodes.push({ method, node })
  }

  if (node.parametricChildren && node.parametricChildren[0]) {
    if (!flattened.children[':']) {
      flattened.children[':'] = {
        prefix: ':',
        nodes: [],
        children: {}
      }
    }
    flattenNode(flattened.children[':'], node.parametricChildren[0], method)
  }

  if (node.wildcardChild) {
    if (!flattened.children['*']) {
      flattened.children['*'] = {
        prefix: '*',
        nodes: [],
        children: {}
      }
    }
    flattenNode(flattened.children['*'], node.wildcardChild, method)
  }

  if (node.staticChildren) {
    for (const child of Object.values(node.staticChildren)) {
      // split on the slash separator but use a regex to lookahead and not actually match it, preserving it in the returned string segments
      const childPrefixSegments = child.prefix.split(pathRegExp)
      let cursor = flattened
      let parent
      for (const segment of childPrefixSegments) {
        parent = cursor
        cursor = cursor.children[segment]
        if (!cursor) {
          cursor = {
            prefix: segment,
            nodes: [],
            children: {}
          }
          parent.children[segment] = cursor
        }
      }
      flattenNode(cursor, child, method)
    }
  }
}

function compressFlattenedNode (flattenedNode) {
  const childKeys = Object.keys(flattenedNode.children)
  if (flattenedNode.nodes.length === 0 && childKeys.length === 1) {
    const child = flattenedNode.children[childKeys[0]]
    if (child.nodes.length <= 1) {
      compressFlattenedNode(child)
      flattenedNode.nodes = child.nodes
      flattenedNode.prefix += child.prefix
      flattenedNode.children = child.children
      return flattenedNode
    }
  }

  for (const key of Object.keys(flattenedNode.children)) {
    compressFlattenedNode(flattenedNode.children[key])
  }

  return flattenedNode
}

module.exports = { flattenNode, compressFlattenedNode, prettyPrintFlattenedNode, prettyPrintRoutesArray }
