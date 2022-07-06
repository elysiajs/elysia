'use strict'

const HandlerStorage = require('./handler_storage')

const NODE_TYPES = {
  STATIC: 0,
  PARAMETRIC: 1,
  WILDCARD: 2
}

class Node {
  constructor () {
    this.handlerStorage = new HandlerStorage()
  }
}

class ParentNode extends Node {
  constructor () {
    super()
    this.staticChildren = {}
  }

  findStaticMatchingChild (path, pathIndex) {
    const staticChild = this.staticChildren[path.charAt(pathIndex)]
    if (staticChild === undefined || !staticChild.matchPrefix(path, pathIndex)) {
      return null
    }
    return staticChild
  }

  createStaticChild (path) {
    if (path.length === 0) {
      return this
    }

    let staticChild = this.staticChildren[path.charAt(0)]
    if (staticChild) {
      let i = 1
      for (; i < staticChild.prefix.length; i++) {
        if (path.charCodeAt(i) !== staticChild.prefix.charCodeAt(i)) {
          staticChild = staticChild.split(this, i)
          break
        }
      }
      return staticChild.createStaticChild(path.slice(i))
    }

    const label = path.charAt(0)
    this.staticChildren[label] = new StaticNode(path)
    return this.staticChildren[label]
  }
}

class StaticNode extends ParentNode {
  constructor (prefix) {
    super()
    this.prefix = prefix
    this.wildcardChild = null
    this.parametricChildren = []
    this.kind = NODE_TYPES.STATIC
    this._compilePrefixMatch()
  }

  createParametricChild (regex) {
    const regexpSource = regex && regex.source

    let parametricChild = this.parametricChildren.find(child => {
      const childRegexSource = child.regex && child.regex.source
      return childRegexSource === regexpSource
    })

    if (parametricChild) {
      return parametricChild
    }

    parametricChild = new ParametricNode(regex)
    if (regex) {
      this.parametricChildren.unshift(parametricChild)
    } else {
      this.parametricChildren.push(parametricChild)
    }
    return parametricChild
  }

  createWildcardChild () {
    if (this.wildcardChild) {
      return this.wildcardChild
    }

    this.wildcardChild = new WildcardNode()
    return this.wildcardChild
  }

  split (parentNode, length) {
    const parentPrefix = this.prefix.slice(0, length)
    const childPrefix = this.prefix.slice(length)

    this.prefix = childPrefix
    this._compilePrefixMatch()

    const staticNode = new StaticNode(parentPrefix)
    staticNode.staticChildren[childPrefix.charAt(0)] = this
    parentNode.staticChildren[parentPrefix.charAt(0)] = staticNode

    return staticNode
  }

  getNextNode (path, pathIndex, nodeStack, paramsCount) {
    let node = this.findStaticMatchingChild(path, pathIndex)
    let parametricBrotherNodeIndex = 0

    if (node === null) {
      if (this.parametricChildren.length === 0) {
        return this.wildcardChild
      }

      node = this.parametricChildren[0]
      parametricBrotherNodeIndex = 1
    }

    if (this.wildcardChild !== null) {
      nodeStack.push({
        paramsCount,
        brotherPathIndex: pathIndex,
        brotherNode: this.wildcardChild
      })
    }

    for (let i = this.parametricChildren.length - 1; i >= parametricBrotherNodeIndex; i--) {
      nodeStack.push({
        paramsCount,
        brotherPathIndex: pathIndex,
        brotherNode: this.parametricChildren[i]
      })
    }

    return node
  }

  _compilePrefixMatch () {
    if (this.prefix.length === 1) {
      this.matchPrefix = () => true
      return
    }

    const lines = []
    for (let i = 1; i < this.prefix.length; i++) {
      const chatCode = this.prefix.charCodeAt(i)
      lines.push(`path.charCodeAt(i + ${i}) === ${chatCode}`)
    }
    this.matchPrefix = new Function('path', 'i', `return ${lines.join(' && ')}`) // eslint-disable-line
  }
}

class ParametricNode extends ParentNode {
  constructor (regex) {
    super()
    this.regex = regex || null
    this.isRegex = !!regex
    this.kind = NODE_TYPES.PARAMETRIC
  }

  getNextNode (path, pathIndex) {
    return this.findStaticMatchingChild(path, pathIndex)
  }
}

class WildcardNode extends Node {
  constructor () {
    super()
    this.kind = NODE_TYPES.WILDCARD
  }

  getNextNode () {
    return null
  }
}

module.exports = { StaticNode, ParametricNode, WildcardNode, NODE_TYPES }
