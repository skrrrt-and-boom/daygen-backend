import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface MusicTrack {
    id: string;
    url: string;
    name: string;
    genre?: string;
}

@Injectable()
export class MusicService {
    constructor(private readonly prisma: PrismaService) { }

    private readonly catalog: MusicTrack[] = [
        { id: 'upbeat', name: 'Government Hooker (Test)', url: 'https://assets.daygen.ai/music-cyran-roll/test-audio.mp3' },
        { id: 'cinematic', name: 'On God', url: 'https://assets.daygen.ai/music-cyran-roll/tcmac.fr%20-%20Kanye%20West%20-%20On%20God.mp3' },
        { id: 'chill', name: 'Use This Gospel', url: 'https://assets.daygen.ai/music-cyran-roll/tcmac.fr%20-%20Kanye%20West%20-%20Use%20This%20Gospel.mp3' },
        { id: 'corporate', name: 'Selah', url: 'https://assets.daygen.ai/music-cyran-roll/tcmac.fr%20-%20Kanye%20West%20-%20Selah.mp3' },
    ];

    async getAllTracks(userId?: string): Promise<MusicTrack[]> {
        const systemTracks = this.catalog;

        if (userId) {
            const userTracks = await this.prisma.userMusic.findMany({
                where: { userId },
                orderBy: { createdAt: 'desc' }
            });

            const formattedUserTracks: MusicTrack[] = userTracks.map(track => ({
                id: track.id,
                url: track.url,
                name: track.name,
                genre: track.genre || 'Custom Upload'
            }));

            return [...formattedUserTracks, ...systemTracks];
        }

        return systemTracks;
    }

    getRandomTrack(): MusicTrack {
        const randomIndex = Math.floor(Math.random() * this.catalog.length);
        return this.catalog[randomIndex];
    }

    async saveUserTrack(userId: string, data: { name: string, url: string, genre?: string }): Promise<MusicTrack> {
        const track = await this.prisma.userMusic.create({
            data: {
                userId,
                name: data.name,
                url: data.url,
                genre: data.genre
            }
        });

        return {
            id: track.id,
            url: track.url,
            name: track.name,
            genre: track.genre || 'Custom Upload'
        };
    }
}
