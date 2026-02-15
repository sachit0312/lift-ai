export const checkForUpdateAsync = jest.fn().mockResolvedValue({ isAvailable: false });
export const fetchUpdateAsync = jest.fn().mockResolvedValue({});
export const reloadAsync = jest.fn().mockResolvedValue(undefined);
export const useUpdates = jest.fn().mockReturnValue({ isUpdateAvailable: false, isUpdatePending: false });
