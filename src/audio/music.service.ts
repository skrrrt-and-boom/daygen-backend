import { Injectable } from '@nestjs/common';

export interface MusicTrack {
    id: string;
    url: string;
    name: string;
}

@Injectable()
export class MusicService {
    private readonly catalog: MusicTrack[] = [
        { id: 'upbeat', name: 'Government Hooker (Test)', url: 'https://pub-82eeb6c8781b41e6ad18622c727f1cfc.r2.dev/music-cyran-roll/test-audio.mp3' },
        { id: 'cinematic', name: 'On God', url: 'https://pub-82eeb6c8781b41e6ad18622c727f1cfc.r2.dev/music-cyran-roll/tcmac.fr%20-%20Kanye%20West%20-%20On%20God.mp3' },
        { id: 'chill', name: 'Use This Gospel', url: 'https://pub-82eeb6c8781b41e6ad18622c727f1cfc.r2.dev/music-cyran-roll/tcmac.fr%20-%20Kanye%20West%20-%20Use%20This%20Gospel.mp3' },
        { id: 'corporate', name: 'Selah', url: 'https://pub-82eeb6c8781b41e6ad18622c727f1cfc.r2.dev/music-cyran-roll/tcmac.fr%20-%20Kanye%20West%20-%20Selah.mp3' },
    ];

    getAllTracks(): MusicTrack[] {
        return this.catalog;
    }

    getRandomTrack(): MusicTrack {
        const randomIndex = Math.floor(Math.random() * this.catalog.length);
        return this.catalog[randomIndex];
    }
}
