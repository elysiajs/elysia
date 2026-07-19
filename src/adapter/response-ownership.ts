const borrowedResponses = new WeakSet<Response>()

/**
 * Mark a Response as reusable by its owner.
 *
 * Elysia will preserve the original body by using the conservative clone/tee
 * response path when response metadata must be applied.
 */
export function borrow<const T extends Response>(response: T): T {
	borrowedResponses.add(response)
	return response
}

export const isBorrowedResponse = (response: Response) =>
	borrowedResponses.has(response)
