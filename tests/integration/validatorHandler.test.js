import { describe, it, expect } from 'vitest';
import { setupServer } from 'msw/node';
import { rest } from 'msw';
import { createClient } from '../client'; // Assuming you have a client setup for testing

const server = setupServer();

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('validatorHandler', () => {
    it('should return validation errors in JSON format', async () => {
      const client = createClient({ baseURL: 'http://localhost:3000' });

          rest.post('/sign-up', (req, res, ctx) => {
            return res(ctx.status(400), ctx.json({ errors: [{ message: 'Password must be at least 8 characters long' }] }));
          });

      try {
        await client.signUp({ username: 'testuser', password: 'short' });
      } catch (error) {
        expect(error.response.status).toBe(400);
        expect(error.response.headers['content-type']).toBe('application/json');
        expect(error.response.data).toEqual({ errors: [{ message: 'Password must be at least 8 characters long' }] });
      }
    });
       }
     });
   });
  });
});
