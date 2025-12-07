import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

@Injectable()
export class CleanupService {
    private readonly logger = new Logger(CleanupService.name);

    @Cron(CronExpression.EVERY_HOUR)
    handleCron() {
        this.logger.log('Running scheduled cleanup of temporary files...');
        this.cleanOldTempDirs();
    }

    private cleanOldTempDirs() {
        const tmpDir = os.tmpdir();
        const maxAgeMs = 60 * 60 * 1000; // 1 hour
        const now = Date.now();

        try {
            const files = fs.readdirSync(tmpDir);
            let deletedCount = 0;

            for (const file of files) {
                // Look for directories starting with 'job-'
                if (file.startsWith('job-')) {
                    const fullPath = path.join(tmpDir, file);
                    try {
                        const stats = fs.statSync(fullPath);
                        if (stats.isDirectory() && (now - stats.mtimeMs > maxAgeMs)) {
                            this.logger.log(`Deleting old temp dir: ${fullPath}`);
                            fs.rmSync(fullPath, { recursive: true, force: true });
                            deletedCount++;
                        }
                    } catch (err) {
                        this.logger.warn(`Failed to check/delete ${fullPath}`, err);
                    }
                }
            }

            if (deletedCount > 0) {
                this.logger.log(`Cleanup complete. Deleted ${deletedCount} old directories.`);
            } else {
                this.logger.debug('No old temp directories found to clean.'); // Using sys/debug level if available, else log
            }
        } catch (err) {
            this.logger.error('Error reading temp directory for cleanup', err);
        }
    }
}
