import { Elysia } from '../src'
import { join } from 'path'

// Example of using Bun.FileSystemRouter with Elysia
// This allows routing based on file system structure like Next.js

const app = new Elysia()
	.fileSystemRouter({
		dir: join(process.cwd(), 'pages'), // Directory containing route files
		style: 'nextjs', // Use Next.js style routing
		origin: 'http://localhost:3000',
		assetPrefix: '/_next/static/'
	})
	.listen(3000)

console.log('Server running on http://localhost:3000')

// Example file structure:
// pages/
// ├── index.ts                    -> GET /
// ├── about.ts                    -> GET /about
// ├── blog/
// │   ├── index.ts                -> GET /blog
// │   └── [slug].ts               -> GET /blog/:slug
// └── api/
//     ├── users/
//     │   ├── index.ts            -> GET /api/users, POST /api/users
//     │   └── [id].ts             -> GET /api/users/:id, PUT /api/users/:id, DELETE /api/users/:id
//     └── posts/
//         └── [[...slug]].ts       -> GET /api/posts/*, POST /api/posts/*

// Example page file: pages/index.ts
/*
export default ({ params, query, request }) => {
	return {
		message: 'Hello from file system routing!',
		params,
		query
	}
}
*/

// Example dynamic route: pages/blog/[slug].ts
/*
export default ({ params, query, request }) => {
	return {
		slug: params.slug,
		content: `Content for blog post: ${params.slug}`
	}
}
*/

// Example API route with multiple methods: pages/api/users/index.ts
/*
export default {
	GET: ({ params, query, request }) => {
		return {
			message: 'Get all users',
			params,
			query
		}
	},
	POST: ({ params, query, request }) => {
		return {
			message: 'Create a new user',
			params,
			query
		}
	}
}
*/

// Example API route with method-specific handlers: pages/api/users/[id].ts
/*
export default {
	GET: ({ params, query, request }) => {
		return {
			message: `Get user ${params.id}`,
			userId: params.id,
			params,
			query
		}
	},
	PUT: ({ params, query, request }) => {
		return {
			message: `Update user ${params.id}`,
			userId: params.id,
			params,
			query
		}
	},
	PATCH: ({ params, query, request }) => {
		return {
			message: `Patch user ${params.id}`,
			userId: params.id,
			params,
			query
		}
	},
	DELETE: ({ params, query, request }) => {
		return {
			message: `Delete user ${params.id}`,
			userId: params.id,
			params,
			query
		}
	}
}
*/

// Example catch-all route: pages/api/posts/[[...slug]].ts
/*
export default {
	GET: ({ params, query, request }) => {
		return {
			message: `Get posts for path: ${params.slug}`,
			path: params.slug,
			params,
			query
		}
	},
	POST: ({ params, query, request }) => {
		return {
			message: `Create post for path: ${params.slug}`,
			path: params.slug,
			params,
			query
		}
	}
}
*/
