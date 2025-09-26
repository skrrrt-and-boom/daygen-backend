import { Injectable } from '@nestjs/common';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';

@Injectable()
export class R2Service {
  private readonly s3Client: S3Client;
  private readonly bucketName: string;
  private readonly publicUrl: string;

  constructor() {
    this.bucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME || 'daygen-assets';
    this.publicUrl = process.env.CLOUDFLARE_R2_PUBLIC_URL || '';

    this.s3Client = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.CLOUDFLARE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || '',
      },
    });
  }

  /**
   * Upload a file to R2 and return the public URL
   */
  async uploadFile(
    file: Express.Multer.File,
    folder: string = 'images',
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
    folder: string = 'images',
  ): Promise<string> {
    // Remove data URL prefix if present
    const base64 = base64Data.replace(/^data:image\/[a-z]+;base64,/, '');
    const buffer = Buffer.from(base64, 'base64');
    
    const fileExtension = this.getFileExtensionFromMimeType(mimeType);
    const fileName = `${folder}/${randomUUID()}${fileExtension}`;

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: fileName,
      Body: buffer,
      ContentType: mimeType,
      CacheControl: 'public, max-age=31536000',
    });

    await this.s3Client.send(command);

    return `${this.publicUrl}/${fileName}`;
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
    folder: string = 'images',
  ): Promise<{ uploadUrl: string; publicUrl: string }> {
    const key = `${folder}/${randomUUID()}-${fileName}`;

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000',
    });

    const uploadUrl = await getSignedUrl(this.s3Client, command, {
      expiresIn: 3600, // 1 hour
    });

    const publicUrl = `${this.publicUrl}/${key}`;

    return { uploadUrl, publicUrl };
  }

  /**
   * Check if R2 is properly configured
   */
  isConfigured(): boolean {
    return !!(
      process.env.CLOUDFLARE_R2_ACCOUNT_ID &&
      process.env.CLOUDFLARE_R2_ACCESS_KEY_ID &&
      process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY &&
      process.env.CLOUDFLARE_R2_BUCKET_NAME &&
      process.env.CLOUDFLARE_R2_PUBLIC_URL
    );
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
    };
    return mimeToExt[mimeType] || '.png';
  }
}
