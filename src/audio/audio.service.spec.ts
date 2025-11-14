import { ServiceUnavailableException, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AudioService } from './audio.service';

const ELEVEN_KEY = 'test-eleven-key';

describe('AudioService', () => {
  let service: AudioService;
  let configGetMock: jest.Mock;
  const originalFetch = global.fetch;

  beforeEach(() => {
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
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('throws if ElevenLabs key missing', async () => {
    configGetMock.mockReturnValueOnce(undefined);

    await expect(service.listVoices()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('lists voices from ElevenLabs', async () => {
    const mockJson = {
      voices: [
        {
          voice_id: 'voice-1',
          name: 'Demo Voice',
          description: 'Sample description',
          preview_url: 'https://example.com/voice.mp3',
        },
      ],
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(mockJson),
    });

    const result = await service.listVoices();

    expect(result.success).toBe(true);
    expect(result.voices).toHaveLength(1);
    expect(result.voices[0].id).toEqual('voice-1');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.elevenlabs.io/v1/voices',
      expect.objectContaining({
        headers: expect.objectContaining({ 'xi-api-key': ELEVEN_KEY }),
      }),
    );
  });

  it('propagates ElevenLabs error messages when listing voices', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: jest.fn().mockResolvedValue({
        message: 'Invalid api key',
      }),
    });

    await expect(service.listVoices()).rejects.toMatchObject({
      status: 401,
      message: 'Invalid api key',
    });
  });

  it('clones voice from uploaded file', async () => {
    const multerFile = {
      originalname: 'sample.wav',
      buffer: Buffer.from([1, 2, 3]),
      mimetype: 'audio/wav',
    } as Express.Multer.File;

    const payload = {
      voice_id: 'clone-1',
      name: 'Sample Voice',
      description: 'desc',
      preview_url: 'https://example.com/voice.mp3',
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(payload),
    });

    const result = await service.cloneVoiceFromFile(multerFile, {
      name: 'Sample Voice',
      description: 'desc',
      labels: { source: 'upload' },
    });

    expect(result.success).toBe(true);
    expect(result.voice.id).toBe('clone-1');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.elevenlabs.io/v1/voices/add',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'xi-api-key': ELEVEN_KEY }),
      }),
    );
  });

  it('generates speech and returns base64 payload', async () => {
    const audioBuffer = Buffer.from([0, 1, 2, 3, 4]);
    const headers = new Headers({ 'content-type': 'audio/mpeg' });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers,
      arrayBuffer: jest.fn().mockResolvedValue(audioBuffer),
    });

    const result = await service.generateSpeech({
      text: 'Hello!',
      voiceId: 'voice-123',
    });

    expect(result.success).toBe(true);
    expect(result.voiceId).toBe('voice-123');
    expect(result.audioBase64).toEqual(audioBuffer.toString('base64'));
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.elevenlabs.io/v1/text-to-speech/voice-123',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'xi-api-key': ELEVEN_KEY,
          'Content-Type': 'application/json',
        }),
      }),
    );
  });

  it('throws HttpException when ElevenLabs returns generate error', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: jest.fn().mockResolvedValue({ message: 'Rate limited' }),
    });

    await expect(
      service.generateSpeech({ text: 'Hello!' }),
    ).rejects.toBeInstanceOf(HttpException);
  });
});

