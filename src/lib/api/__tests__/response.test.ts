/**
 * @jest-environment node
 */
import { jsonError, jsonOk } from '../response';

describe('API response helpers', () => {
  it('jsonOk wraps data with success: true and default status 200', async () => {
    const response = jsonOk({ foo: 'bar' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ success: true, foo: 'bar' });
  });

  it('jsonOk supports a custom status code', async () => {
    const response = jsonOk({ foo: 'bar' }, 201);
    expect(response.status).toBe(201);
  });

  it('jsonError wraps a message with success: false and default status 400', async () => {
    const response = jsonError('Something went wrong');
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toEqual({ success: false, error: 'Something went wrong' });
  });

  it('jsonError supports a custom status code', async () => {
    const response = jsonError('Not found', 404);
    expect(response.status).toBe(404);
  });
});
