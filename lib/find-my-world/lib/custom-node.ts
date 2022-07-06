'use strict'

import HandlerStorage from './handler-storage'

export enum NODE_TYPES {
    STATIC,
    PARAMETRIC,
    WILDCARD
}

export interface NodeStack {
    paramsCount: number
    brotherPathIndex: number
    brotherNode: ParametricNode | WildcardNode
}

export class RadixNode {
    handlerStorage: HandlerStorage

    constructor() {
        this.handlerStorage = new HandlerStorage()
    }
}

export class ParentNode extends RadixNode {
    staticChildren: Record<string, StaticNode>

    constructor() {
        super()

        this.staticChildren = {}
    }

    findStaticMatchingChild(path, pathIndex) {
        const staticChild = this.staticChildren[path.charAt(pathIndex)]

        if (
            staticChild === undefined ||
            !staticChild.matchPrefix(path, pathIndex)
        )
            return null

        return staticChild
    }

    createStaticChild(path: string): ParentNode | StaticNode {
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

export class StaticNode extends ParentNode {
    prefix: string
    wildcardChild: WildcardNode | null
    parametricChildren: any[]

    kind = NODE_TYPES.STATIC

    constructor(prefix: string) {
        super()

        this.prefix = prefix
        this.wildcardChild = null
        this.parametricChildren = []
    }

    createParametricChild(regex) {
        const regexpSource = regex && regex.source

        let parametricChild = this.parametricChildren.find((child) => {
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

    createWildcardChild() {
        this.wildcardChild ??= new WildcardNode()

        return this.wildcardChild
    }

    split(parentNode, length) {
        const parentPrefix = this.prefix.slice(0, length)
        const childPrefix = this.prefix.slice(length)

        this.prefix = childPrefix

        const staticNode = new StaticNode(parentPrefix)
        staticNode.staticChildren[childPrefix.charAt(0)] = this
        parentNode.staticChildren[parentPrefix.charAt(0)] = staticNode

        return staticNode
    }

    getNextNode(
        path: string,
        pathIndex: number,
        nodeStack: NodeStack[],
        paramsCount: number
    ) {
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

        for (
            let i = this.parametricChildren.length - 1;
            i >= parametricBrotherNodeIndex;
            i--
        ) {
            nodeStack.push({
                paramsCount,
                brotherPathIndex: pathIndex,
                brotherNode: this.parametricChildren[i]
            })
        }

        return node
    }

    matchPrefix(path?: string, index?: number) {
        if (this.prefix.length === 1) return true

        const lines: string[] = []
        for (let i = 1; i < this.prefix.length; i++) {
            const chatCode = this.prefix.charCodeAt(i)

            lines.push(`path.charCodeAt(i + ${i}) === ${chatCode}`)
        }

        return lines.join(' && ')
    }
}

export class ParametricNode extends ParentNode {
    regex: RegExp | null
    isRegex: boolean

    kind = NODE_TYPES.PARAMETRIC

    constructor(regex) {
        super()

        this.regex = regex
        this.isRegex = !!regex
    }

    getNextNode(path: string, pathIndex: number) {
        return this.findStaticMatchingChild(path, pathIndex)
    }
}

export class WildcardNode extends RadixNode {
    kind = NODE_TYPES.WILDCARD

    constructor() {
        super()
    }

    getNextNode() {
        return null
    }
}
