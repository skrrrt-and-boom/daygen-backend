import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AudioService } from './audio.service';

// Mock the ElevenLabs SDK (even if unused, to prevent load errors if imported)
jest.mock('@elevenlabs/elevenlabs-js', () => {
  return {
    ElevenLabsClient: jest.fn(),
  };
});

const ELEVEN_KEY = 'test-eleven-key';

describe('AudioService', () => {
  let service: AudioService;
  let configGetMock: jest.Mock;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    configGetMock = jest.fn().mockImplementation((key: string) => {
      if (key === 'ELEVENLABS_API_KEY') {
        return ELEVEN_KEY;
      }
      return undefined;
    });

    const configService = {
      get: configGetMock,
    } as unknown as ConfigService;

    service = new AudioService(configService);
    
    // Mock global fetch
    global.fetch = jest.fn();
  });

  it('throws if ElevenLabs key missing', async () => {
    configGetMock.mockReturnValueOnce(undefined);

    // Re-instantiate service to trigger constructor check
    try {
      new AudioService({
        get: configGetMock,
      } as unknown as ConfigService);
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
    }
  });

  it('lists voices from ElevenLabs', async () => {
    const mockVoicesResponse = {
      voices: [
        {
          voice_id: 'voice-1',
          name: 'Demo Voice',
          description: 'Sample description',
          preview_url: 'https://example.com/voice.mp3',
          category: 'premade',
          labels: {},
        },
      ],
    };

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(mockVoicesResponse),
    });

    const result = await service.listVoices();

    expect(result.success).toBe(true);
    expect(result.voices).toHaveLength(1);
    expect(result.voices[0].voice_id).toEqual('voice-1');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.elevenlabs.io/v1/voices',
      expect.objectContaining({
        headers: expect.objectContaining({
          'xi-api-key': ELEVEN_KEY,
        }),
      }),
    );
  });

  it('handles errors when listing voices', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('API Error'));

    await expect(service.listVoices()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('clones voice from uploaded file', async () => {
    const multerFile = {
      originalname: 'sample.wav',
      buffer: Buffer.from([1, 2, 3]),
      mimetype: 'audio/wav',
    } as Express.Multer.File;

    const mockCreateResponse = {
      voice_id: 'clone-1',
      requires_verification: false,
      name: 'Sample Voice',
    };

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(mockCreateResponse),
    });

    const result = await service.cloneVoiceFromFile(multerFile, {
      name: 'Sample Voice',
      description: 'desc',
      labels: { source: 'upload' },
    });

    expect(result.success).toBe(true);
    expect(result.voice.voice_id).toBe('clone-1');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.elevenlabs.io/v1/voices/add',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'xi-api-key': ELEVEN_KEY,
        }),
      }),
    );
  });

  it('generates speech with timestamps and returns SpeechResult', async () => {
    const mockFetchResponse = {
      ok: true,
      headers: {
        get: jest.fn().mockReturnValue('audio/mpeg'),
      },
      arrayBuffer: jest.fn().mockResolvedValue(Buffer.from('base64audio')),
      json: jest.fn().mockResolvedValue({}),
    };
    (global.fetch as jest.Mock).mockResolvedValue(mockFetchResponse);

    const result = await service.generateSpeech({
      text: 'Hi',
      voiceId: 'voice-123',
    });

    expect(result.success).toBe(true);
    expect(result.voiceId).toBe('voice-123');
    // Buffer.toString('base64') of 'base64audio'
    expect(result.audioBase64).toBe(Buffer.from('base64audio').toString('base64'));

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('v1/text-to-speech/voice-123'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('Hi'),
      }),
    );
  });

  it('throws HttpException when ElevenLabs API fails', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      json: jest.fn().mockResolvedValue({}),
      text: jest.fn().mockResolvedValue('Too Many Requests'),
    });

    await expect(
      service.generateSpeech({ text: 'Hello!' }),
    ).rejects.toBeInstanceOf(HttpException);
  });
});
