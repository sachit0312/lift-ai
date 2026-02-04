import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

const mockSignUp = jest.fn().mockResolvedValue({ error: null });
jest.mock('../../services/supabase', () => ({
  supabase: {
    auth: { signUp: (...args: any[]) => mockSignUp(...args) },
  },
}));

import SignupScreen from '../SignupScreen';

describe('SignupScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSignUp.mockResolvedValue({ error: null });
  });

  it('renders email, password, and confirm password inputs', () => {
    const { getByTestId } = render(<SignupScreen navigation={{ navigate: mockNavigate } as any} route={{} as any} />);
    expect(getByTestId('signup-email')).toBeTruthy();
    expect(getByTestId('signup-password')).toBeTruthy();
    expect(getByTestId('signup-confirm')).toBeTruthy();
  });

  it('shows error when passwords do not match', async () => {
    const { getByTestId, findByText } = render(<SignupScreen navigation={{ navigate: mockNavigate } as any} route={{} as any} />);

    fireEvent.changeText(getByTestId('signup-email'), 'test@test.com');
    fireEvent.changeText(getByTestId('signup-password'), 'password123');
    fireEvent.changeText(getByTestId('signup-confirm'), 'different123');
    fireEvent.press(getByTestId('signup-btn'));

    expect(await findByText(/passwords do not match/i)).toBeTruthy();
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it('shows error when fields are empty', async () => {
    const { getByTestId, findByText } = render(<SignupScreen navigation={{ navigate: mockNavigate } as any} route={{} as any} />);

    fireEvent.press(getByTestId('signup-btn'));

    expect(await findByText(/please fill in all fields/i)).toBeTruthy();
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it('shows error when password is too short', async () => {
    const { getByTestId, findByText } = render(<SignupScreen navigation={{ navigate: mockNavigate } as any} route={{} as any} />);

    fireEvent.changeText(getByTestId('signup-email'), 'test@test.com');
    fireEvent.changeText(getByTestId('signup-password'), 'short');
    fireEvent.changeText(getByTestId('signup-confirm'), 'short');
    fireEvent.press(getByTestId('signup-btn'));

    expect(await findByText(/password must be at least 8 characters/i)).toBeTruthy();
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it('calls signUp with matching passwords', async () => {
    const { getByTestId } = render(<SignupScreen navigation={{ navigate: mockNavigate } as any} route={{} as any} />);

    fireEvent.changeText(getByTestId('signup-email'), 'test@test.com');
    fireEvent.changeText(getByTestId('signup-password'), 'password123');
    fireEvent.changeText(getByTestId('signup-confirm'), 'password123');
    fireEvent.press(getByTestId('signup-btn'));

    await waitFor(() => {
      expect(mockSignUp).toHaveBeenCalledWith({
        email: 'test@test.com',
        password: 'password123',
      });
    });
  });

  it('navigates to Login on link press', () => {
    const { getByText } = render(<SignupScreen navigation={{ navigate: mockNavigate } as any} route={{} as any} />);
    fireEvent.press(getByText(/already have an account/i));
    expect(mockNavigate).toHaveBeenCalledWith('Login');
  });
});
