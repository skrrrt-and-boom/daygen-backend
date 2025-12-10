const { PrismaClient } = require('@prisma/client');
const { S3Client, ListObjectsV2Command, CopyObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

// Load environment variables
require('dotenv').config();

const prisma = new PrismaClient();

const R2_ACCOUNT_ID = process.env.CLOUDFLARE_R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.CLOUDFLARE_R2_BUCKET_NAME || 'daygen-assets';
const R2_PUBLIC_URL = process.env.CLOUDFLARE_R2_PUBLIC_URL;

// Initialize S3 client for R2
const s3Client = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
    useAccelerateEndpoint: false,
    disableHostPrefix: true,
});

async function migrateCyranRollPath() {
    console.log('🚀 Starting Cyran Roll Path Fix Migration...\n');
    console.log('Configuration:');
    console.log('- Bucket:', R2_BUCKET_NAME);
    console.log('- Source:', 'cyran-roll/images/');
    console.log('- Target:', 'cyran-roll-images/');

    try {
        // Step 1: List all files in cyran-roll/images/
        console.log('\nChecking for files to move...');

        let continuationToken = undefined;
        const filesToMove = [];

        do {
            const command = new ListObjectsV2Command({
                Bucket: R2_BUCKET_NAME,
                Prefix: 'cyran-roll/images/',
                ContinuationToken: continuationToken,
            });

            const response = await s3Client.send(command);
            if (response.Contents) {
                filesToMove.push(...response.Contents);
            }
            continuationToken = response.NextContinuationToken;
        } while (continuationToken);

        console.log(`Found ${filesToMove.length} files to move.`);

        if (filesToMove.length === 0) {
            console.log('No files to migrate.');
            return;
        }

        // Step 2: Migrate files
        console.log('\n📦 Step 2: Moving files...');
        const migrationMap = new Map(); // oldUrl -> newUrl

        for (const file of filesToMove) {
            const fileName = file.Key.split('/').pop();
            const newKey = `cyran-roll-images/${fileName}`;

            try {
                // Copy object
                await s3Client.send(new CopyObjectCommand({
                    Bucket: R2_BUCKET_NAME,
                    CopySource: `${R2_BUCKET_NAME}/${file.Key}`,
                    Key: newKey,
                    ACL: 'public-read',
                }));

                // Store mapping for DB update
                const oldUrl = `${R2_PUBLIC_URL}/${file.Key}`;
                const newUrl = `${R2_PUBLIC_URL}/${newKey}`;
                migrationMap.set(oldUrl, newUrl);

                // Delete old object
                await s3Client.send(new DeleteObjectCommand({
                    Bucket: R2_BUCKET_NAME,
                    Key: file.Key
                }));

                console.log(`Moved: ${fileName}`);
            } catch (err) {
                console.error(`Failed to move ${file.Key}:`, err);
            }
        }

        // Step 3: Update Database Jobs
        console.log('\n🔄 Step 3: Updating Database Jobs...');

        // Find all CYRAN_ROLL jobs
        const jobs = await prisma.job.findMany({
            where: {
                type: 'CYRAN_ROLL',
                metadata: {
                    not: null
                }
            }
        });

        console.log(`Scanning ${jobs.length} jobs for reference updates...`);
        let updatedJobs = 0;

        for (const job of jobs) {
            let metadataStr = JSON.stringify(job.metadata);
            let modified = false;

            // Replace all occurrences of known old URLs
            for (const [oldUrl, newUrl] of migrationMap.entries()) {
                if (metadataStr.includes(oldUrl)) {
                    // Global replace for this URL
                    metadataStr = metadataStr.split(oldUrl).join(newUrl);
                    modified = true;
                }
            }

            if (modified) {
                const newMetadata = JSON.parse(metadataStr);
                await prisma.job.update({
                    where: { id: job.id },
                    data: { metadata: newMetadata }
                });
                updatedJobs++;
            }
        }

        console.log(`\n\n✅ Database update complete. Updated ${updatedJobs} jobs.`);
        console.log('🎉 Migration finished successfully.');

    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        await prisma.$disconnect();
    }
}

migrateCyranRollPath();
