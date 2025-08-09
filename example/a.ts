import { Elysia, t, form, ElysiaCustomStatusResponse } from '../src'

new Elysia().get('/course', async ({ error, dta }) => {
	const response = database
		.transaction(async (tx) => {
			const statuses = await tx.courseStatus.all()

			await tx.course.create([
				{
					title: 'Course x' + Math.random(),
					statusId: statuses[0].data.id
				}
			])

			return 'something'
		})
		.catch(() => {
			return error(400, 'Some weird issue')
		})

	if (response instanceof ElysiaCustomStatusResponse)
		return response
})
