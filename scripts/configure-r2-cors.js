const { S3Client, PutBucketCorsCommand, GetBucketCorsCommand } = require('@aws-sdk/client-s3');
require('dotenv').config();

async function configureR2Cors() {
    console.log('🔧 Configuring R2 CORS...\n');

    const accountId = process.env.CLOUDFLARE_R2_ACCOUNT_ID;
    const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
    const bucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME;

    if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
        console.error('❌ Missing environment variables');
        return;
    }

    const s3Client = new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: {
            accessKeyId,
            secretAccessKey,
        },
    });

    const corsRules = [
        {
            AllowedHeaders: ['*'],
            AllowedMethods: ['GET', 'HEAD'],
            AllowedOrigins: ['http://localhost:5173', 'http://localhost:3000', '*'], // Allow localhost and all for public assets
            ExposeHeaders: ['ETag'],
            MaxAgeSeconds: 3000,
        },
    ];

    try {
        console.log(`Setting CORS for bucket: ${bucketName}`);
        const command = new PutBucketCorsCommand({
            Bucket: bucketName,
            CORSConfiguration: {
                CORSRules: corsRules,
            },
        });

        await s3Client.send(command);
        console.log('✅ CORS configuration updated successfully!');

        // Verify
        console.log('\nVerifying new configuration...');
        const verifyCommand = new GetBucketCorsCommand({ Bucket: bucketName });
        const response = await s3Client.send(verifyCommand);
        console.log('Current CORS Rules:', JSON.stringify(response.CORSRules, null, 2));

    } catch (error) {
        console.error('❌ Failed to update CORS:', error);
    }
}

configureR2Cors();
