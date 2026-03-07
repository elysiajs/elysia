export const isHTMLBundle = (handle: any) => {
	return (
		typeof handle === 'object' &&
		handle !== null &&
		(handle.toString() === '[object HTMLBundle]' ||
			(typeof handle.index === 'string' &&
				typeof handle.files === 'object' &&
				handle.files !== null))
	)
}
