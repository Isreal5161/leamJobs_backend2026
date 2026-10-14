import { jest } from '@jest/globals';

process.env.NODE_ENV = 'test';

const mockScheduleCallbacks = [];
const mockScheduleHandles = [];
const mockDisconnectDatabase = jest.fn().mockResolvedValue(undefined);
const mockProcessPendingRecovery = jest.fn();
const mockServerClose = jest.fn();
const mockHandlers = {};
const mockServer = { close: mockServerClose };

jest.unstable_mockModule('../src/app.js', () => ({
  default: { listen: jest.fn((_port, _host, callback) => { callback(); return mockServer; }) },
}));
jest.unstable_mockModule('../src/config/env.js', () => ({
  env: { PORT: 5000, HOST: 'localhost', NODE_ENV: 'test' },
}));
jest.unstable_mockModule('../src/config/database.js', () => ({
  connectDatabase: jest.fn().mockResolvedValue(undefined),
  disconnectDatabase: mockDisconnectDatabase,
}));
jest.unstable_mockModule('node-cron', () => ({
  default: {
    schedule: jest.fn((_expression, callback) => {
      mockScheduleCallbacks.push(callback);
      const handle = { stop: jest.fn() };
      mockScheduleHandles.push(handle);
      return handle;
    }),
  },
}));
jest.unstable_mockModule('../src/services/jobAlerts.service.js', () => ({
  processJobAlerts: jest.fn().mockResolvedValue(undefined),
}));
jest.unstable_mockModule('../src/services/contractPayment.service.js', () => ({
  processPendingContractWebhookEvents: mockProcessPendingRecovery,
}));

test('shutdown stops cron and waits for active contract webhook recovery before disconnecting', async () => {
  let finishRecovery;
  mockProcessPendingRecovery.mockReturnValue(new Promise((resolve) => { finishRecovery = resolve; }));
  mockServerClose.mockImplementation((callback) => { mockHandlers.serverClose = callback(); });
  const onSpy = jest.spyOn(process, 'on').mockImplementation((event, handler) => {
    mockHandlers[event] = handler;
    return process;
  });
  const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined);

  try {
    await import('../src/server.js');
    await new Promise(setImmediate);

    mockScheduleCallbacks[1]();
    mockHandlers.SIGTERM();
    expect(mockScheduleHandles.map(({ stop }) => stop)).toHaveLength(2);
    expect(mockScheduleHandles.every(({ stop }) => stop.mock.calls.length === 1)).toBe(true);
    expect(mockDisconnectDatabase).not.toHaveBeenCalled();

    finishRecovery();
    await mockHandlers.serverClose;

    expect(mockDisconnectDatabase).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(0);
  } finally {
    onSpy.mockRestore();
    exitSpy.mockRestore();
  }
});
