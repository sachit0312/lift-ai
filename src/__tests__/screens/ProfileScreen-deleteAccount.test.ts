/**
 * Tests for Batch 4 Task 3: handleDeleteAccount must wipe local SQLite
 * (via clearAllLocalData) after Supabase signOut so the next user of
 * the device can't read the deleted account's workouts.
 */
describe('Batch 4 Task 3: delete account clears local data', () => {
  it('grep invariant: ProfileScreen.handleDeleteAccount calls clearAllLocalData after signOut', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '../../screens/ProfileScreen.tsx'),
      'utf8',
    );

    // Imports clearAllLocalData from database service
    expect(src).toMatch(/import\s+[^;]*clearAllLocalData[^;]*from\s+['"]\.\.\/services\/database['"]/);

    // The call sequence: deleteAccount → signOut → clearAllLocalData
    // Use a multi-line regex to verify ordering inside handleDeleteAccount.
    const deleteHandlerSlice = src.split('handleDeleteAccount')[1] ?? '';
    expect(deleteHandlerSlice).toMatch(/deleteAccount\(\)/);
    expect(deleteHandlerSlice).toMatch(/signOut\(\)/);
    expect(deleteHandlerSlice).toMatch(/clearAllLocalData\(\)/);

    // clearAllLocalData appears AFTER signOut in source order.
    const deleteAccountIdx = deleteHandlerSlice.indexOf('deleteAccount()');
    const signOutIdx = deleteHandlerSlice.indexOf('signOut()');
    const clearIdx = deleteHandlerSlice.indexOf('clearAllLocalData()');
    expect(deleteAccountIdx).toBeGreaterThan(-1);
    expect(signOutIdx).toBeGreaterThan(-1);
    expect(clearIdx).toBeGreaterThan(-1);
    expect(deleteAccountIdx).toBeLessThan(signOutIdx);
    expect(signOutIdx).toBeLessThan(clearIdx);
  });
});
