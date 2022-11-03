# Writing Tests
KingWorld is designed to be serverless, only one simple `handle` is need to be assigned to serverless function.

This also be used to create simple test environment, by simply call `handle` function.

```typescript
import { describe, expect, it } from "bun:test"

const req = (path: string) => new Request(path)

describe('Correctness', () => {
	it('[GET] /', async () => {
		const app = new KingWorld().get('/', () => 'Hi')
		const res = await app.handle(req('/'))

		expect(await res.text()).toBe('Hi')
	})
})
```