import { Injectable } from '@nestjs/common';

@Injectable()
export class MusicService {
    private readonly catalog = {
        upbeat: 'https://pub-82eeb6c8781b41e6ad18622c727f1cfc.r2.dev/music-cyran-roll/test-audio.mp3', // gavorment hooker
        cinematic: 'https://pub-82eeb6c8781b41e6ad18622c727f1cfc.r2.dev/music-cyran-roll/tcmac.fr%20-%20Kanye%20West%20-%20On%20God.mp3', // On God
        chill: 'https://pub-82eeb6c8781b41e6ad18622c727f1cfc.r2.dev/music-cyran-roll/tcmac.fr%20-%20Kanye%20West%20-%20Use%20This%20Gospel.mp3', // Use this gospel
        corporate: 'https://pub-82eeb6c8781b41e6ad18622c727f1cfc.r2.dev/music-cyran-roll/tcmac.fr%20-%20Kanye%20West%20-%20Selah.mp3', // Selah
    };

    getBackgroundTrack(style: string): string {
        const normalizedStyle = style.toLowerCase();
        return this.catalog[normalizedStyle] || this.catalog.upbeat;
    }
}
