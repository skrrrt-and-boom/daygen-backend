# Cloudflare R2 Setup for File Storage

This guide explains how to set up Cloudflare R2 for storing generated images and gallery files.

## 1. Create Cloudflare R2 Bucket

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Navigate to **R2 Object Storage**
3. Click **Create bucket**
4. Name your bucket (e.g., `daygen-assets`)
5. Choose a location close to your users
6. Click **Create bucket**

## 2. Configure R2 Bucket

### Public Access
1. Go to your bucket settings
2. Navigate to **Settings** → **Public access**
3. Enable **Allow Access**
4. Add a custom domain (optional but recommended):
   - Go to **Custom Domains**
   - Add a subdomain like `assets.yourdomain.com`
   - This will give you clean URLs like `https://assets.yourdomain.com/image.png`

### CORS Configuration
1. Go to **Settings** → **CORS policy**
2. Add the following CORS policy:

```json
[
  {
    "AllowedOrigins": [
      "https://daygen0.vercel.app",
      "https://*.vercel.app",
      "http://localhost:5173"
    ],
    "AllowedMethods": ["GET", "POST", "PUT", "DELETE"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3600
  }
]
```

## 3. Get R2 Credentials

1. Go to **R2** → **Manage R2 API tokens**
2. Click **Create API token**
3. Choose **Custom token**
4. Set permissions:
   - **Account**: `Cloudflare R2:Edit`
   - **Zone Resources**: `Include` → `All zones` (or specific zone)
5. Click **Continue to summary**
6. Copy the credentials:
   - **Account ID**
   - **Access Key ID**
   - **Secret Access Key**

## 4. Environment Variables

Add these to your backend environment variables:

```bash
# Cloudflare R2 Configuration
CLOUDFLARE_R2_ACCOUNT_ID=your_account_id
CLOUDFLARE_R2_ACCESS_KEY_ID=your_access_key_id
CLOUDFLARE_R2_SECRET_ACCESS_KEY=your_secret_access_key
CLOUDFLARE_R2_BUCKET_NAME=daygen-assets
CLOUDFLARE_R2_PUBLIC_URL=https://assets.yourdomain.com
```

## 5. Frontend Configuration

Update your frontend to upload files to R2:

```typescript
// Example upload function
async function uploadToR2(file: File): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);
  
  const response = await fetch('/api/upload', {
    method: 'POST',
    body: formData,
  });
  
  const { url } = await response.json();
  return url;
}
```

## 6. Backend Upload Endpoint (Optional)

If you want to handle uploads through your backend, create an upload endpoint:

```typescript
// src/upload/upload.controller.ts
@Controller('upload')
export class UploadController {
  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(@UploadedFile() file: Express.Multer.File) {
    // Upload to R2 and return URL
    const url = await this.uploadService.uploadToR2(file);
    return { url };
  }
}
```

## 7. Usage in Gallery

The gallery system is already configured to work with external URLs. Simply store the R2 URL in the `assetUrl` field:

```typescript
// When creating a gallery entry
const galleryEntry = await galleryService.create(userId, {
  assetUrl: 'https://assets.yourdomain.com/path/to/image.png',
  metadata: { /* optional metadata */ }
});
```

## Benefits of R2

- **Cost-effective**: No egress fees
- **Fast**: Global CDN
- **Reliable**: 99.999999999% (11 9's) durability
- **Compatible**: S3-compatible API
- **Secure**: Fine-grained access controls

## Pricing

- **Storage**: $0.015 per GB per month
- **Class A Operations** (PUT, POST, LIST): $4.50 per million requests
- **Class B Operations** (GET, HEAD): $0.36 per million requests
- **Egress**: Free (unlike AWS S3)

For a typical image generation app, costs are very low since most operations are reads and there are no egress fees.
