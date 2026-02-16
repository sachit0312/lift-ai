jest.mock('react-native-url-polyfill/auto', () => ({}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const mockInvoke = jest.fn();
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    auth: {
      getSession: jest.fn(),
      onAuthStateChange: jest.fn(),
      signOut: jest.fn(),
    },
    functions: {
      invoke: mockInvoke,
    },
  })),
}));

let supabase: any;
let deleteAccount: any;

beforeAll(() => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
  const mod = require('../supabase');
  supabase = mod.supabase;
  deleteAccount = mod.deleteAccount;
});

describe('supabase service', () => {
  beforeEach(() => jest.clearAllMocks());

  it('exports a supabase client', () => {
    expect(supabase).toBeDefined();
    expect(supabase.auth).toBeDefined();
  });

  it('exports deleteAccount function', () => {
    expect(typeof deleteAccount).toBe('function');
  });

  it('deleteAccount invokes the delete-account edge function', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: null });
    await deleteAccount();
    expect(mockInvoke).toHaveBeenCalledWith('delete-account');
  });

  it('deleteAccount throws when edge function returns an error', async () => {
    const err = new Error('Forbidden');
    mockInvoke.mockResolvedValue({ data: null, error: err });
    await expect(deleteAccount()).rejects.toThrow('Forbidden');
  });
});
