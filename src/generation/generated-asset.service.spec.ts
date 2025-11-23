import { Test, TestingModule } from '@nestjs/testing';
import { GeneratedAssetService, GeneratedAsset } from './generated-asset.service';
import { R2FilesService } from '../r2files/r2files.service';
import { R2Service } from '../upload/r2.service';
import { ProviderHttpService } from './provider-http.service';
import { SanitizedUser } from '../users/types';
import * as crypto from 'crypto';

describe('GeneratedAssetService', () => {
    let service: GeneratedAssetService;
    let r2FilesService: Partial<Record<keyof R2FilesService, jest.Mock>>;
    let r2Service: Partial<Record<keyof R2Service, jest.Mock>>;
    let providerHttpService: Partial<Record<keyof ProviderHttpService, jest.Mock>>;

    const mockUser = {
        authUserId: 'user-123',
        email: 'test@example.com',
    } as SanitizedUser;

    beforeEach(async () => {
        r2FilesService = {
            create: jest.fn(),
        };
        r2Service = {
            isConfigured: jest.fn().mockReturnValue(true),
            uploadBase64Image: jest.fn(),
        };
        providerHttpService = {
            fetchWithTimeout: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                GeneratedAssetService,
                { provide: R2FilesService, useValue: r2FilesService },
                { provide: R2Service, useValue: r2Service },
                { provide: ProviderHttpService, useValue: providerHttpService },
            ],
        }).compile();

        service = module.get<GeneratedAssetService>(GeneratedAssetService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('persistAsset', () => {
        it('should persist a base64 asset with hash-based filename', async () => {
            const base64 = 'SGVsbG8gV29ybGQ='; // "Hello World"
            const asset: GeneratedAsset = {
                base64,
                mimeType: 'image/png',
            };
            const metadata = { prompt: 'test prompt', model: 'test-model' };

            const expectedHash = crypto.createHash('sha256').update(base64).digest('hex');

            r2Service.uploadBase64Image!.mockResolvedValue('https://r2.example.com/image.png');
            r2FilesService.create!.mockResolvedValue({
                id: 'file-123',
                fileUrl: 'https://r2.example.com/image.png',
            });

            await service.persistAsset(mockUser, asset, metadata);

            expect(r2Service.uploadBase64Image).toHaveBeenCalledWith(
                base64,
                'image/png',
                'generated-images',
                `${expectedHash}.png`
            );
            expect(r2FilesService.create).toHaveBeenCalledWith(mockUser.authUserId, expect.objectContaining({
                fileUrl: 'https://r2.example.com/image.png',
                prompt: 'test prompt',
            }));
            expect(asset.r2FileId).toBe('file-123');
            expect(asset.remoteUrl).toBe('https://r2.example.com/image.png');
        });

        it('should handle dataUrl input', async () => {
            const base64 = 'SGVsbG8gV29ybGQ=';
            const dataUrl = `data:image/png;base64,${base64}`;
            const asset: GeneratedAsset = {
                dataUrl,
                mimeType: 'image/png', // Added mimeType
            };
            const metadata = { prompt: 'test prompt', model: 'test-model' };

            const expectedHash = crypto.createHash('sha256').update(base64).digest('hex');

            r2Service.uploadBase64Image!.mockResolvedValue('https://r2.example.com/image.png');
            r2FilesService.create!.mockResolvedValue({
                id: 'file-123',
                fileUrl: 'https://r2.example.com/image.png',
            });

            await service.persistAsset(mockUser, asset, metadata);

            expect(asset.base64).toBe(base64);
            expect(asset.mimeType).toBe('image/png');
            expect(r2Service.uploadBase64Image).toHaveBeenCalledWith(
                base64,
                'image/png',
                'generated-images',
                `${expectedHash}.png`
            );
        });
    });
});
