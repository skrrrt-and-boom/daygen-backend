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
        expect(service.getBackgroundTrack('upbeat')).toBe('https://pub-82eeb6c8781b41e6ad18622c727f1cfc.r2.dev/music-cyran-roll/test-audio.mp3');
        expect(service.getBackgroundTrack('cinematic')).toBe('https://pub-82eeb6c8781b41e6ad18622c727f1cfc.r2.dev/music-cyran-roll/tcmac.fr%20-%20Kanye%20West%20-%20On%20God.mp3');
        expect(service.getBackgroundTrack('CHILL')).toBe('https://pub-82eeb6c8781b41e6ad18622c727f1cfc.r2.dev/music-cyran-roll/tcmac.fr%20-%20Kanye%20West%20-%20Use%20This%20Gospel.mp3');
    });

    it('should return default URL for unknown style', () => {
        expect(service.getBackgroundTrack('unknown')).toBe('https://pub-82eeb6c8781b41e6ad18622c727f1cfc.r2.dev/music-cyran-roll/test-audio.mp3');
    });
});
