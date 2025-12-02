import { Injectable } from '@nestjs/common';

@Injectable()
export class MusicService {
    private readonly catalog = {
        upbeat: 'https://r2.daygen.ai/music/upbeat.mp3',
        cinematic: 'https://r2.daygen.ai/music/cinematic.mp3',
        chill: 'https://r2.daygen.ai/music/chill.mp3',
        corporate: 'https://r2.daygen.ai/music/corporate.mp3',
    };

    getBackgroundTrack(style: string): string {
        const normalizedStyle = style.toLowerCase();
        return this.catalog[normalizedStyle] || this.catalog.upbeat;
    }
}
