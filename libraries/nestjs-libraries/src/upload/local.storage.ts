import { IUploadProvider } from './upload.interface';
import { mkdirSync, unlink, writeFileSync } from 'fs';
// @ts-ignore
import mime from 'mime';
import { extname } from 'path';
import axios from 'axios';

export class LocalStorage implements IUploadProvider {
  constructor(private uploadDirectory: string) {}

  async uploadSimple(path: string) {
    let imageData: Buffer;
    let contentType: string;
    let findExtension: string;

    // Handle data URIs (base64 images)
    if (path.startsWith('data:')) {
      const matches = path.match(/^data:([^;]+);base64,(.+)$/);
      if (!matches) {
        throw new Error('Invalid data URI format');
      }
      contentType = matches[1];
      const base64Data = matches[2];
      imageData = Buffer.from(base64Data, 'base64');
      
      // Extract extension from content type, default to png
      // Normalize content type (remove any extra parameters)
      const normalizedContentType = contentType.split(';')[0].trim().toLowerCase();
      
      // Try mime library first
      try {
        findExtension = mime.getExtension(normalizedContentType) || null;
      } catch (e) {
        findExtension = null;
      }
      
      // Fallback: check common image types manually
      if (!findExtension) {
        if (normalizedContentType === 'image/png' || normalizedContentType.includes('png')) {
          findExtension = 'png';
        } else if (normalizedContentType === 'image/jpeg' || normalizedContentType === 'image/jpg' || normalizedContentType.includes('jpeg') || normalizedContentType.includes('jpg')) {
          findExtension = 'jpg';
        } else if (normalizedContentType === 'image/gif' || normalizedContentType.includes('gif')) {
          findExtension = 'gif';
        } else if (normalizedContentType === 'image/webp' || normalizedContentType.includes('webp')) {
          findExtension = 'webp';
        } else {
          // Default to png for base64 images from OpenAI (DALL-E returns PNG)
          findExtension = 'png';
        }
      }
      
      console.log(`[LocalStorage] Data URI detected - ContentType: ${contentType}, Normalized: ${normalizedContentType}, Extension: ${findExtension}, MimeResult: ${mime.getExtension(normalizedContentType) || 'null'}`);
    } else {
      // Handle URL (existing behavior)
      const loadImage = await axios.get(path, { responseType: 'arraybuffer' });
      contentType =
        loadImage?.headers?.['content-type'] ||
        loadImage?.headers?.['Content-Type'] ||
        'image/png';
      findExtension = mime.getExtension(contentType);
      if (!findExtension) {
        if (contentType.includes('png')) findExtension = 'png';
        else if (contentType.includes('jpeg') || contentType.includes('jpg')) findExtension = 'jpg';
        else if (contentType.includes('gif')) findExtension = 'gif';
        else if (contentType.includes('webp')) findExtension = 'webp';
        else findExtension = 'png';
      }
      imageData = Buffer.from(loadImage.data);
    }

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');

    const innerPath = `/${year}/${month}/${day}`;
    const dir = `${this.uploadDirectory}${innerPath}`;
    mkdirSync(dir, { recursive: true });

    const randomName = Array(32)
      .fill(null)
      .map(() => Math.round(Math.random() * 16).toString(16))
      .join('');

    const filePath = `${dir}/${randomName}.${findExtension}`;
    const publicPath = `${innerPath}/${randomName}.${findExtension}`;
    
    // Ensure extension is valid (should never be null at this point)
    if (!findExtension || findExtension === 'null') {
      console.error(`[LocalStorage] Invalid extension detected: ${findExtension}, defaulting to png`);
      findExtension = 'png';
      // Rebuild paths with correct extension
      const correctedFilePath = `${dir}/${randomName}.${findExtension}`;
      const correctedPublicPath = `${innerPath}/${randomName}.${findExtension}`;
      writeFileSync(correctedFilePath, imageData);
      console.log(`[LocalStorage] File saved: ${correctedFilePath}`);
      return process.env.FRONTEND_URL + '/uploads' + correctedPublicPath;
    }
    
    // Logic to save the file to the filesystem goes here
    writeFileSync(filePath, imageData);
    console.log(`[LocalStorage] File saved: ${filePath}, Public path: ${publicPath}`);

    return process.env.FRONTEND_URL + '/uploads' + publicPath;
  }

  async uploadFile(file: Express.Multer.File): Promise<any> {
    try {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');

      const innerPath = `/${year}/${month}/${day}`;
      const dir = `${this.uploadDirectory}${innerPath}`;
      mkdirSync(dir, { recursive: true });

      const randomName = Array(32)
        .fill(null)
        .map(() => Math.round(Math.random() * 16).toString(16))
        .join('');

      const filePath = `${dir}/${randomName}${extname(file.originalname)}`;
      const publicPath = `${innerPath}/${randomName}${extname(
        file.originalname
      )}`;

      // Logic to save the file to the filesystem goes here
      writeFileSync(filePath, file.buffer);

      return {
        filename: `${randomName}${extname(file.originalname)}`,
        path: process.env.FRONTEND_URL + '/uploads' + publicPath,
        mimetype: file.mimetype,
        originalname: file.originalname,
      };
    } catch (err) {
      console.error('Error uploading file to Local Storage:', err);
      throw err;
    }
  }

  async removeFile(filePath: string): Promise<void> {
    // Logic to remove the file from the filesystem goes here
    return new Promise((resolve, reject) => {
      unlink(filePath, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
}
