export const mockNavigation = {
  navigate: jest.fn(),
  goBack: jest.fn(),
  setOptions: jest.fn(),
};

export const mockRoute = (params = {}) => ({
  params,
  key: 'mock-route',
  name: 'MockScreen',
});

export function mockUseFocusEffect() {
  return (cb: Function) => {
    const React = require('react');
    React.useEffect(() => { cb(); }, []);
  };
}
