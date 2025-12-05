import { Test, TestingModule } from '@nestjs/testing';
import { MusicService } from './music.service';

describe('MusicService', () => {
    let service: MusicService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [MusicService],
        }).compile();

        service = module.get<MusicService>(MusicService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('should return correct URL for known styles', () => {
        expect(service.getBackgroundTrack('upbeat')).toBe('https://r2.daygen.ai/music/upbeat.mp3');
        expect(service.getBackgroundTrack('cinematic')).toBe('https://r2.daygen.ai/music/cinematic.mp3');
        expect(service.getBackgroundTrack('CHILL')).toBe('https://r2.daygen.ai/music/chill.mp3');
    });

    it('should return default URL for unknown style', () => {
        expect(service.getBackgroundTrack('unknown')).toBe('https://r2.daygen.ai/music/upbeat.mp3');
    });
});
