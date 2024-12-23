interface Node<T = unknown, Nodes extends Node<any, any>[] = []> {
	value: T
	neighbors: Nodes
}

type A = Node<1, [B, C]> // Node<1, [Node<2>, Node<3>]>
type B = Node<2, [A, D]> // Node<2, [Node<1>, Node<3>]>
type C = Node<3, [A, B]> // Node<3, [Node<1>, Node<2>]>
type D = Node<4, [B, C]> // Node<4, [Node<2>, Node<3>]>

type FilterOut<Arr extends any[], Target> =
	Arr extends [
		infer Head,
		...infer Tail
	]
		? Head extends Target
			? FilterOut<Tail, Target>
			: [Head, ...FilterOut<Tail, Target>]
		: []

type BFS<
	Root extends Node<any, any[]>,
	ToFind,
	Searched extends Node<any, any>[] = []
> = Root extends (Searched['length'] extends 0 ? never : Searched[number])
	? FilterOut<Root['neighbors'], Searched[number]> extends [
			infer Current extends Node<any, any>
		]
		? BFS<Current, ToFind, [...Searched, Root]>
		: never
	: Root['value'] extends ToFind
		? Root & { __order: Searched }
		: Root['neighbors'] extends [
					infer Current extends Node<any, any>,
					...infer Rest extends Node<any, any>[]
			  ]
			? Current['value'] extends ToFind
				? Current
				: Rest extends [infer Next extends Node<any, any>]
					? BFS<Next, ToFind, [...Searched, Root]>
					: never
			: never


type Result = BFS<A, 4> // Node<4, [Node<2>, Node<3>]>










function breadthFirstSearch<T>(
	root: Node<unknown, Node<any, any>[]>,
	toFind: T,
	searched: Node<any, any>[] = []
): Node<T> | null {
	if (searched.includes(root)) return null
	if (root.value === toFind) return root as Node<T>

	for (const current of root.neighbors) {
		if (current.value === toFind) return current

		const a = breadthFirstSearch(current, toFind, [...searched, root])
	}

	return null
}
