// A release build must never silently talk to localhost: with no EXPO_PUBLIC_API_URL it has no server address.
jest.mock('react-native', () => ({ Platform: { OS: 'android' } }), { virtual: true });
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { hostUri: '192.168.1.20:8081' } } }), { virtual: true });

const load = (dev: boolean, url?: string) => {
  jest.resetModules();
  (globalThis as any).__DEV__ = dev;
  if (url === undefined) delete process.env.EXPO_PUBLIC_API_URL; else process.env.EXPO_PUBLIC_API_URL = url;
  return require('../src/config/api');
};

describe('API address configuration', () => {
  test('development: learns the backend address from the Expo dev server', () => {
    const c = load(true);
    expect(c.API_BASE_URL).toBe('http://192.168.1.20:8000');
    expect(c.API_CONFIGURED).toBe(true);
  });

  test('release build without EXPO_PUBLIC_API_URL has no server address (never localhost)', () => {
    const c = load(false);
    expect(c.API_BASE_URL).toBe('');
    expect(c.API_CONFIGURED).toBe(false);
  });

  test('EXPO_PUBLIC_API_URL wins in every build and loses trailing slashes', () => {
    expect(load(false, 'https://api.example.com/').API_BASE_URL).toBe('https://api.example.com');
    expect(load(true, 'https://api.example.com').API_BASE_URL).toBe('https://api.example.com');
  });

  test('a deployed http:// address is flagged as insecure; https and local network addresses are not', () => {
    expect(load(false, 'http://api.example.com').API_IS_INSECURE).toBe(true);
    expect(load(false, 'https://api.example.com').API_IS_INSECURE).toBe(false);
    expect(load(true, 'http://192.168.1.20:8000').API_IS_INSECURE).toBe(false);
  });
});
