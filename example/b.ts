type ToArray<
	T extends string,
	Acc extends string[] = []
> = T extends `${infer Char}${infer Rest}`
	? ToArray<Rest, Char extends ' ' ? Acc : [Char, ...Acc]>
	: Acc

type PalindromeCheck<T extends string[]> = T extends [
	infer First,
	...infer Rest extends string[],
	infer Last
]
	? First extends Last
		? Rest['length'] extends 0
			? true
			: PalindromeCheck<Rest>
		: false
	: T['length'] extends 1
	? true
	: false

type IsPalindrome<T extends string> =
	ToArray<T> extends infer Arr extends string[] ? PalindromeCheck<Arr> : false


type A = IsPalindrome<'aibohphobia'>
