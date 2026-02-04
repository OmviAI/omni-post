import { CloudflareStorage } from './cloudflare.storage';
import { IUploadProvider } from './upload.interface';
import { LocalStorage } from './local.storage';

export class UploadFactory {
  static createStorage(): IUploadProvider {
    const storageProvider = process.env.STORAGE_PROVIDER || 'local';
    
    console.log(`[UploadFactory] Creating storage provider: ${storageProvider}`);
    console.log(`[UploadFactory] STORAGE_PROVIDER env var: ${process.env.STORAGE_PROVIDER || 'NOT SET (defaulting to local)'}`);

    switch (storageProvider) {
      case 'local':
        const uploadDir = process.env.UPLOAD_DIRECTORY || './uploads';
        if (!uploadDir) {
          throw new Error('UPLOAD_DIRECTORY environment variable is required for local storage');
        }
        return new LocalStorage(uploadDir);
      case 'cloudflare':
        const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
        const accessKey = process.env.CLOUDFLARE_ACCESS_KEY;
        const secretKey = process.env.CLOUDFLARE_SECRET_ACCESS_KEY;
        const region = process.env.CLOUDFLARE_REGION || 'auto';
        const bucketName = process.env.CLOUDFLARE_BUCKETNAME;
        const bucketUrl = process.env.CLOUDFLARE_BUCKET_URL;

        console.log(`[UploadFactory] Cloudflare config check:
          - CLOUDFLARE_ACCOUNT_ID: ${accountId ? 'SET' : 'MISSING'}
          - CLOUDFLARE_ACCESS_KEY: ${accessKey ? 'SET' : 'MISSING'}
          - CLOUDFLARE_SECRET_ACCESS_KEY: ${secretKey ? 'SET' : 'MISSING'}
          - CLOUDFLARE_BUCKETNAME: ${bucketName ? 'SET' : 'MISSING'}
          - CLOUDFLARE_BUCKET_URL: ${bucketUrl ? 'SET' : 'MISSING'}
          - CLOUDFLARE_REGION: ${region}`);

        if (!accountId || !accessKey || !secretKey || !bucketName || !bucketUrl) {
          const missing = [];
          if (!accountId) missing.push('CLOUDFLARE_ACCOUNT_ID');
          if (!accessKey) missing.push('CLOUDFLARE_ACCESS_KEY');
          if (!secretKey) missing.push('CLOUDFLARE_SECRET_ACCESS_KEY');
          if (!bucketName) missing.push('CLOUDFLARE_BUCKETNAME');
          if (!bucketUrl) missing.push('CLOUDFLARE_BUCKET_URL');
          
          throw new Error(
            `Cloudflare R2 configuration is incomplete. Missing environment variables: ${missing.join(', ')}`
          );
        }

        console.log(`[UploadFactory] Creating CloudflareStorage with bucket: ${bucketName}, URL: ${bucketUrl}`);
        return new CloudflareStorage(
          accountId,
          accessKey,
          secretKey,
          region,
          bucketName,
          bucketUrl
        );
      default:
        throw new Error(`Invalid storage type ${storageProvider}`);
    }
  }
}
