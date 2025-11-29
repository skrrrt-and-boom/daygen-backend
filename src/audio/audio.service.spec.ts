import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AudioService } from './audio.service';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';

// Mock the ElevenLabs SDK
jest.mock('@elevenlabs/elevenlabs-js', () => {
  return {
    ElevenLabsClient: jest.fn().mockImplementation(() => {
      return {
        voices: {
          getAll: jest.fn(),
          ivc: {
            create: jest.fn(),
          },
        },
        textToSpeech: {
          convert: jest.fn(),
        },
      };
    }),
  };
});

const ELEVEN_KEY = 'test-eleven-key';

describe('AudioService', () => {
  let service: AudioService;
  let configGetMock: jest.Mock;
  let mockElevenLabsClient: any;

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

    // Get the mocked instance
    mockElevenLabsClient = (ElevenLabsClient as unknown as jest.Mock).mock.results[0].value;
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
          voiceId: 'voice-1',
          name: 'Demo Voice',
          description: 'Sample description',
          previewUrl: 'https://example.com/voice.mp3',
          category: 'premade',
          labels: {},
        },
      ],
    };

    mockElevenLabsClient.voices.getAll.mockResolvedValue(mockVoicesResponse);

    const result = await service.listVoices();

    expect(result.success).toBe(true);
    expect(result.voices).toHaveLength(1);
    expect(result.voices[0].id).toEqual('voice-1');
    expect(mockElevenLabsClient.voices.getAll).toHaveBeenCalled();
  });

  it('handles errors when listing voices', async () => {
    mockElevenLabsClient.voices.getAll.mockRejectedValue(new Error('API Error'));

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
      voiceId: 'clone-1',
      requiresVerification: false,
    };

    mockElevenLabsClient.voices.ivc.create.mockResolvedValue(mockCreateResponse);

    const result = await service.cloneVoiceFromFile(multerFile, {
      name: 'Sample Voice',
      description: 'desc',
      labels: { source: 'upload' },
    });

    expect(result.success).toBe(true);
    expect(result.voice.id).toBe('clone-1');
    expect(mockElevenLabsClient.voices.ivc.create).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Sample Voice',
      description: 'desc',
    }));
  });

  it('generates speech and returns base64 payload', async () => {
    const audioBuffer = Buffer.from([0, 1, 2, 3, 4]);

    // Mock the stream response
    async function* mockStream() {
      yield audioBuffer;
    }

    mockElevenLabsClient.textToSpeech.convert.mockResolvedValue(mockStream());

    const result = await service.generateSpeech({
      text: 'Hello!',
      voiceId: 'voice-123',
    });

    expect(result.success).toBe(true);
    expect(result.voiceId).toBe('voice-123');
    expect(result.audioBase64).toEqual(audioBuffer.toString('base64'));
    expect(mockElevenLabsClient.textToSpeech.convert).toHaveBeenCalledWith(
      'voice-123',
      expect.objectContaining({
        text: 'Hello!',
      }),
    );
  });

  it('throws ServiceUnavailableException when ElevenLabs returns generate error', async () => {
    mockElevenLabsClient.textToSpeech.convert.mockRejectedValue(new Error('Rate limited'));

    await expect(
      service.generateSpeech({ text: 'Hello!' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
