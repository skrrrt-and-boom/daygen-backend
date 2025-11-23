import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ProviderHttpService } from './provider-http.service';

describe('ProviderHttpService', () => {
    let service: ProviderHttpService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ProviderHttpService,
                {
                    provide: ConfigService,
                    useValue: {
                        get: jest.fn((key, defaultValue) => defaultValue),
                    },
                },
            ],
        }).compile();

        service = module.get<ProviderHttpService>(ProviderHttpService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('fetchWithTimeout', () => {
        it('should throw error for invalid protocol', async () => {
            await expect(
                service.fetchWithTimeout('ftp://example.com', {}),
            ).rejects.toThrow('Invalid protocol: ftp:');
        });

        it('should throw error for invalid URL', async () => {
            await expect(
                service.fetchWithTimeout('not-a-url', {}),
            ).rejects.toThrow('Invalid URL: not-a-url');
        });

        it('should use default timeout if not provided', async () => {
            const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(() =>
                Promise.resolve(new Response('ok')),
            );
            await service.fetchWithTimeout('https://example.com', {});
            expect(fetchSpy).toHaveBeenCalled();
        });
    });
});
