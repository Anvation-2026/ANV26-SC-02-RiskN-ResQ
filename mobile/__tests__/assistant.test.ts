jest.mock('react-native', () => ({ Platform: { OS: 'android' } }), { virtual: true });
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { hostUri: '192.168.1.20:8081' } } }), { virtual: true });
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn(), deleteItemAsync: jest.fn() }), { virtual: true });

import { sendChatMessage, getSuggestedQuestions, getAssistantStatus } from '../src/services/api';

describe('AI Assistant client service integration', () => {
  beforeEach(() => {
    (global as any).fetch = jest.fn();
  });

  test('sendChatMessage serializes coordinates, message, and history into request body', async () => {
    const mockResponse = {
      reply: '🌧️ CURRENT FLOOD RISK: LOW',
      sources: [{ title: 'Open-Meteo', type: 'Rainfall', status: 'Active' }],
      risk_badge: { level: 'LOW', score: 10, confidence: 'HIGH' },
      actions: [{ label: 'View Map', action: 'open_map' }],
      provider: 'grounded_engine',
    };

    (global as any).fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const res = await sendChatMessage({
      message: 'What is my flood risk?',
      latitude: 12.9716,
      longitude: 77.5946,
      history: [{ role: 'user', content: 'Hello' }],
    });

    expect((global as any).fetch).toHaveBeenCalledTimes(1);
    const [calledUrl, options] = (global as any).fetch.mock.calls[0];
    expect(calledUrl).toContain('/assistant/chat');
    expect(options.method).toBe('POST');

    const sentBody = JSON.parse(options.body);
    expect(sentBody.message).toBe('What is my flood risk?');
    expect(sentBody.latitude).toBe(12.9716);
    expect(sentBody.longitude).toBe(77.5946);
    expect(sentBody.history).toHaveLength(1);

    expect(res.reply).toContain('CURRENT FLOOD RISK: LOW');
    expect(res.sources[0].title).toBe('Open-Meteo');
  });

  test('getSuggestedQuestions formats query parameters', async () => {
    (global as any).fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        role: 'user',
        questions: ['What is my flood risk?', 'Which roads are blocked?'],
      }),
    });

    const res = await getSuggestedQuestions(12.9716, 77.5946);
    expect((global as any).fetch).toHaveBeenCalledTimes(1);
    const [calledUrl] = (global as any).fetch.mock.calls[0];
    expect(calledUrl).toContain('/assistant/suggested-questions?latitude=12.9716&longitude=77.5946');
    expect(res.questions).toHaveLength(2);
  });

  test('getAssistantStatus queries status endpoint', async () => {
    (global as any).fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'OPERATIONAL',
        provider: 'grounded_engine',
        grounded_sources: [{ name: 'Open-Meteo', status: 'ONLINE' }],
      }),
    });

    const res = await getAssistantStatus();
    expect((global as any).fetch).toHaveBeenCalledTimes(1);
    const [calledUrl] = (global as any).fetch.mock.calls[0];
    expect(calledUrl).toContain('/assistant/status');
    expect(res.status).toBe('OPERATIONAL');
  });
});
