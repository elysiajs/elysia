const borrowedResponses = new WeakSet<Response>()

export function borrow<const T extends Response>(response: T): T {
	borrowedResponses.add(response)

	return response
}

export const isBorrowedResponse = (response: Response) =>
	borrowedResponses.has(response)
