import { Injectable, Logger } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';

@Injectable()
export class R2Service {
  private readonly logger = new Logger(R2Service.name);
  private readonly s3Client: S3Client;
  private readonly bucketName: string;
  private readonly publicUrl: string;
  private readonly accountId: string;
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;

  constructor() {
    // Trim all credentials to remove any whitespace or newlines
    this.accountId = (process.env.CLOUDFLARE_R2_ACCOUNT_ID || '').trim();
    this.accessKeyId = (process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || '').trim();
    this.secretAccessKey = (
      process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || ''
    ).trim();
    this.bucketName = (
      process.env.CLOUDFLARE_R2_BUCKET_NAME || 'daygen-assets'
    ).trim();
    this.publicUrl = (process.env.CLOUDFLARE_R2_PUBLIC_URL || '').trim();

    // Log warnings for validation issues but don't throw errors
    // This allows the backend to start even if R2 is misconfigured
    // R2 will fail only when actually used (during image generation)
    const validationIssues = this.validateCredentials();

    if (validationIssues.length > 0) {
      this.logger.warn(
        `R2 configuration issues detected (backend will still start, but R2 uploads may fail):\n${validationIssues.join('\n')}`,
      );
    } else {
      this.logger.log('R2 credentials validated successfully');
    }

    // Create S3Client only if we have the minimum required credentials
    // This allows the service to exist even if credentials are missing
    if (this.accountId && this.accessKeyId && this.secretAccessKey) {
      const endpoint = `https://${this.accountId}.r2.cloudflarestorage.com`;

      this.logger.log(
        `Initializing R2Service with account: ${this.accountId}, bucket: ${this.bucketName}`,
      );

      this.s3Client = new S3Client({
        region: 'auto',
        endpoint,
        credentials: {
          accessKeyId: this.accessKeyId,
          secretAccessKey: this.secretAccessKey,
        },
        forcePathStyle: true,
        useAccelerateEndpoint: false,
        disableHostPrefix: true,
      });
    } else {
      this.logger.warn(
        'R2Service initialized without full credentials - R2 uploads will fail until credentials are configured',
      );
      // Create a dummy S3Client to prevent null reference errors
      this.s3Client = new S3Client({
        region: 'auto',
        endpoint: 'https://placeholder.r2.cloudflarestorage.com',
        credentials: {
          accessKeyId: 'placeholder',
          secretAccessKey: 'placeholder',
        },
        forcePathStyle: true,
      });
    }
  }

  /**
   * Validate that R2 credentials are properly configured
   * Returns array of error messages (non-blocking, just logs warnings)
   */
  private validateCredentials(): string[] {
    const errors: string[] = [];

    if (!this.accountId) {
      errors.push('CLOUDFLARE_R2_ACCOUNT_ID is missing');
    } else if (this.accountId.length < 32) {
      errors.push(
        'CLOUDFLARE_R2_ACCOUNT_ID appears to be malformed (too short)',
      );
    }

    if (!this.accessKeyId) {
      errors.push('CLOUDFLARE_R2_ACCESS_KEY_ID is missing');
    } else if (this.accessKeyId.length < 20) {
      errors.push(
        'CLOUDFLARE_R2_ACCESS_KEY_ID appears to be malformed (too short)',
      );
    }

    if (!this.secretAccessKey) {
      errors.push('CLOUDFLARE_R2_SECRET_ACCESS_KEY is missing');
    } else if (this.secretAccessKey.length < 40) {
      errors.push(
        'CLOUDFLARE_R2_SECRET_ACCESS_KEY appears to be malformed (too short)',
      );
    }

    if (!this.bucketName) {
      errors.push('CLOUDFLARE_R2_BUCKET_NAME is missing');
    }

    if (!this.publicUrl) {
      errors.push('CLOUDFLARE_R2_PUBLIC_URL is missing');
    }

    return errors;
  }

  /**
   * Upload a file to R2 and return the public URL
   */
  async uploadFile(
    file: Express.Multer.File,
    folder: string = 'generated-images',
  ): Promise<string> {
    const fileExtension = this.getFileExtension(file.originalname);
    const fileName = `${folder}/${randomUUID()}${fileExtension}`;

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: fileName,
      Body: file.buffer,
      ContentType: file.mimetype,
      CacheControl: 'public, max-age=31536000', // Cache for 1 year
    });

    await this.s3Client.send(command);

    // Return the public URL
    return `${this.publicUrl}/${fileName}`;
  }

  /**
   * Upload a base64 image to R2
   */
  async uploadBase64Image(
    base64Data: string,
    mimeType: string = 'image/png',
    folder: string = 'generated-images',
    customFilename?: string,
  ): Promise<string> {
    // Remove data URL prefix if present
    const base64 = base64Data.replace(/^data:image\/[a-z]+;base64,/, '');
    const buffer = Buffer.from(base64, 'base64');

    const fileExtension = this.getFileExtensionFromMimeType(mimeType);
    const fileName = customFilename
      ? `${folder}/${customFilename}`
      : `${folder}/${randomUUID()}${fileExtension}`;

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: fileName,
      Body: buffer,
      ContentType: mimeType,
      CacheControl: 'public, max-age=31536000',
    });

    try {
      await this.s3Client.send(command);
      this.logger.log(`Successfully uploaded file to R2: ${fileName}`);
      return `${this.publicUrl}/${fileName}`;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Check for signature-related errors
      if (
        errorMessage.includes('signature') ||
        errorMessage.includes('Signature')
      ) {
        this.logger.error(
          `R2 signature error during upload. This usually indicates:\n` +
          `1. Malformed credentials (check for extra spaces/newlines in Cloud Run env vars)\n` +
          `2. Clock skew between server and R2 (check server time)\n` +
          `3. Incorrect AWS SDK configuration\n` +
          `Error: ${errorMessage}`,
        );

        throw new Error(
          `R2 upload signature error: ${errorMessage}. ` +
          `Please verify R2 credentials in Google Cloud Run are correctly formatted (no extra spaces or newlines). ` +
          `Original error: ${errorMessage}`,
        );
      }

      this.logger.error(`Failed to upload file to R2: ${errorMessage}`, error);
      throw new Error(`R2 upload failed: ${errorMessage}`);
    }
  }

  /**
   * Delete a file from R2
   */
  async deleteFile(fileUrl: string): Promise<boolean> {
    try {
      // Extract the key from the URL
      const url = new URL(fileUrl);
      const key = url.pathname.substring(1); // Remove leading slash

      const command = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      await this.s3Client.send(command);
      return true;
    } catch (error) {
      console.error('Failed to delete file from R2:', error);
      return false;
    }
  }

  /**
   * Generate a presigned URL for direct uploads from frontend
   */
  async generatePresignedUploadUrl(
    fileName: string,
    contentType: string,
    folder: string = 'generated-images',
  ): Promise<{ uploadUrl: string; publicUrl: string }> {
    const key = `${folder}/${randomUUID()}-${fileName}`;

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000',
    });

    try {
      const uploadUrl = await getSignedUrl(this.s3Client, command, {
        expiresIn: 3600, // 1 hour
      });

      const publicUrl = `${this.publicUrl}/${key}`;

      return { uploadUrl: uploadUrl, publicUrl };
    } catch (error) {
      throw new Error(`Failed to generate presigned URL: ${error}`);
    }
  }

  /**
   * Check if R2 is properly configured
   */
  isConfigured(): boolean {
    return !!(
      this.accountId &&
      this.accessKeyId &&
      this.secretAccessKey &&
      this.bucketName &&
      this.publicUrl
    );
  }

  /**
   * Validate that a URL is a proper R2 public URL
   */
  validateR2Url(url: string): boolean {
    if (!url) return false;
    return url.startsWith(this.publicUrl);
  }

  /**
   * Check if a URL is a base64 data URL (should not be stored in database)
   */
  isBase64Url(url: string): boolean {
    return Boolean(url && url.startsWith('data:image/'));
  }

  /**
   * Upload an arbitrary buffer (useful for videos)
   */
  async uploadBuffer(
    buffer: Buffer,
    contentType: string,
    folder: string = 'generated-assets',
    customFilename?: string,
  ): Promise<string> {
    const extension = this.getFileExtensionFromMimeType(contentType);
    const fileName = customFilename
      ? `${folder}/${customFilename}`
      : `${folder}/${randomUUID()}${extension}`;

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: fileName,
      Body: buffer,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000',
    });

    await this.s3Client.send(command);

    return `${this.publicUrl}/${fileName}`;
  }

  private getFileExtension(filename: string): string {
    const lastDot = filename.lastIndexOf('.');
    return lastDot !== -1 ? filename.substring(lastDot) : '.png';
  }

  private getFileExtensionFromMimeType(mimeType: string): string {
    const mimeToExt: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/jpg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'image/svg+xml': '.svg',
      'video/mp4': '.mp4',
      'video/mpeg': '.mpeg',
      'video/quicktime': '.mov',
      'video/webm': '.webm',
      'audio/mpeg': '.mp3',
      'audio/mp3': '.mp3',
      'audio/wav': '.wav',
    };
    return mimeToExt[mimeType] || '.png';
  }
}
