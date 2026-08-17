import { withTimeout } from '../withTimeout';

describe('withTimeout', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('clears its deadline after the operation resolves', async () => {
    const result = await withTimeout(Promise.resolve('ready'), 1_000, 'timed out');

    expect(result).toBe('ready');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('clears its deadline after the operation rejects', async () => {
    await expect(withTimeout(Promise.reject(new Error('network down')), 1_000, 'timed out'))
      .rejects.toThrow('network down');

    expect(jest.getTimerCount()).toBe(0);
  });

  it('rejects with its supplied message after the deadline', async () => {
    const operation = new Promise<void>(() => {});
    const timed = withTimeout(operation, 1_000, 'background pull timed out');

    jest.advanceTimersByTime(1_000);

    await expect(timed).rejects.toThrow('background pull timed out');
  });
});
