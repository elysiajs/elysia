import { Elysia, t } from '../src'

/**
 * Example: Nested File Uploads with Multipart Forms
 *
 * Elysia supports nested file uploads using dot notation in multipart forms.
 * This allows you to organize files and data in a nested structure while
 * still using standard multipart/form-data encoding.
 *
 * How it works:
 * 1. Client sends files with dot notation keys (e.g., "user.avatar")
 * 2. Elysia automatically reconstructs the nested object structure
 * 3. Your handler receives a properly nested object
 */

const app = new Elysia()
	// Basic nested file upload
	.post(
		'/user/profile',
		({ body }) => ({
			message: 'Profile created!',
			user: {
				name: body.user.name,
				avatarSize: body.user.avatar.size
			}
		}),
		{
			body: t.Object({
				user: t.Object({
					name: t.String(),
					avatar: t.File()
				})
			})
		}
	)

	// Deeply nested files
	.post(
		'/user/portfolio',
		({ body }) => ({
			bio: body.user.profile.bio,
			photoCount: body.user.profile.photos.length
		}),
		{
			body: t.Object({
				user: t.Object({
					profile: t.Object({
						bio: t.String(),
						photos: t.Files()
					})
				})
			})
		}
	)

	// Mixed flat and nested fields
	.post(
		'/post',
		({ body }) => ({
			title: body.title,
			authorName: body.author.name,
			imageSize: body.author.avatar.size
		}),
		{
			body: t.Object({
				title: t.String(),
				author: t.Object({
					name: t.String(),
					avatar: t.File()
				})
			})
		}
	)
	.listen(3000)

console.log(`🦊 Server running at http://${app.server?.hostname}:${app.server?.port}`)

/**
 * Client-side usage (with fetch):
 *
 * const formData = new FormData()
 * formData.append('user.name', 'John')
 * formData.append('user.avatar', fileBlob)
 *
 * await fetch('http://localhost:3000/user/profile', {
 *   method: 'POST',
 *   body: formData
 * })
 *
 *
 * Eden client usage (future):
 *
 * await client.user.profile.post({
 *   user: {
 *     name: 'John',
 *     avatar: fileBlob  // Eden will flatten this automatically
 *   }
 * })
 */
