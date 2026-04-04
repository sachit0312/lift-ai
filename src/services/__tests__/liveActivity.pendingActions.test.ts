import { Platform } from 'react-native';
import * as Sentry from '@sentry/react-native';
import { getItem } from '../../../modules/shared-user-defaults';
import { applyPendingWidgetActions } from '../liveActivity';

const mockGetItem = getItem as jest.MockedFunction<typeof getItem>;
const mockCaptureException = Sentry.captureException as jest.MockedFunction<typeof Sentry.captureException>;

describe('applyPendingWidgetActions error handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(Platform, 'OS', { value: 'ios', writable: true });
  });

  it('calls Sentry.captureException when JSON.parse throws on malformed action queue', () => {
    // Simulate malformed JSON in the action queue
    mockGetItem.mockReturnValueOnce('not-valid-json{{{');

    const result = applyPendingWidgetActions();

    expect(result).toBe(0);
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect(mockCaptureException).toHaveBeenCalledWith(expect.any(SyntaxError));
  });

  it('returns 0 (not -Infinity) when parse fails', () => {
    mockGetItem.mockReturnValueOnce('[invalid');

    const result = applyPendingWidgetActions();

    expect(result).toBe(0);
  });

  it('returns 0 and does not call captureException when no action queue exists', () => {
    mockGetItem.mockReturnValueOnce(null);

    const result = applyPendingWidgetActions();

    expect(result).toBe(0);
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it('returns total delta for valid adjustRest actions', () => {
    mockGetItem.mockReturnValueOnce(
      JSON.stringify([
        { type: 'adjustRest', delta: 15, ts: 1 },
        { type: 'adjustRest', delta: -15, ts: 2 },
      ])
    );

    const result = applyPendingWidgetActions();

    expect(result).toBe(0);
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it('returns 0 on Android without calling captureException', () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', writable: true });
    mockGetItem.mockReturnValueOnce('invalid-json');

    const result = applyPendingWidgetActions();

    expect(result).toBe(0);
    expect(mockCaptureException).not.toHaveBeenCalled();
  });
});
