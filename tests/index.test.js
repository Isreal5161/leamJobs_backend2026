import request from 'supertest';
import app from '../src/app.js';

describe('application health', () => {
	test('reports the API as healthy', async () => {
		const response = await request(app).get('/health');

		expect(response.status).toBe(200);
		expect(response.body.status).toBe('ok');
		expect(response.body.timestamp).toEqual(expect.any(String));
	});
});
