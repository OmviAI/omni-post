import {
  UploadPartCommand,
  S3Client,
  ListPartsCommand,
  CreateMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Request, Response } from 'express';
import crypto from 'crypto';
import path from 'path';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';

const {
  CLOUDFLARE_ACCOUNT_ID,
  CLOUDFLARE_ACCESS_KEY,
  CLOUDFLARE_SECRET_ACCESS_KEY,
  CLOUDFLARE_BUCKETNAME,
  CLOUDFLARE_BUCKET_URL,
} = process.env;

const R2 = new S3Client({
  region: 'auto',
  endpoint: `https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: CLOUDFLARE_ACCESS_KEY!,
    secretAccessKey: CLOUDFLARE_SECRET_ACCESS_KEY!,
  },
  requestChecksumCalculation: 'WHEN_REQUIRED',
});

// Add middleware to remove checksum headers for R2 compatibility
R2.middlewareStack.add(
  (next) =>
    async (args): Promise<any> => {
      const request = args.request as RequestInit;

      // Remove checksum headers (R2 doesn't support them in the same way as S3)
      const headers = request.headers as Record<string, string>;
      delete headers['x-amz-checksum-crc32'];
      delete headers['x-amz-checksum-crc32c'];
      delete headers['x-amz-checksum-sha1'];
      delete headers['x-amz-checksum-sha256'];
      request.headers = headers;

      Object.entries(request.headers).forEach(
        // @ts-ignore
        ([key, value]: [string, string]): void => {
          if (!request.headers) {
            request.headers = {};
          }
          (request.headers as Record<string, string>)[key] = value;
        }
      );

      return next(args);
    },
  { step: 'build', name: 'customHeaders' }
);

// Function to generate a random string
function generateRandomString() {
  return makeId(20);
}

export default async function handleR2Upload(
  endpoint: string,
  req: Request,
  res: Response
) {
  switch (endpoint) {
    case 'create-multipart-upload':
      return createMultipartUpload(req, res);
    case 'prepare-upload-parts':
      return prepareUploadParts(req, res);
    case 'complete-multipart-upload':
      return completeMultipartUpload(req, res);
    case 'list-parts':
      return listParts(req, res);
    case 'abort-multipart-upload':
      return abortMultipartUpload(req, res);
    case 'sign-part':
      return signPart(req, res);
  }
  return res.status(404).end();
}

export async function simpleUpload(
  data: Buffer,
  originalFilename: string,
  contentType: string
) {
  const fileExtension = path.extname(originalFilename); // Extract extension
  const randomFilename = generateRandomString() + fileExtension; // Append extension

  const params = {
    Bucket: CLOUDFLARE_BUCKETNAME,
    Key: randomFilename,
    Body: data,
    ContentType: contentType,
  };

  const command = new PutObjectCommand({ ...params });
  await R2.send(command);

  return CLOUDFLARE_BUCKET_URL + '/' + randomFilename;
}

export async function createMultipartUpload(req: Request, res: Response) {
  const { file, fileHash, contentType } = req.body;
  const fileExtension = path.extname(file.name); // Extract extension
  const randomFilename = generateRandomString() + fileExtension; // Append extension

  try {
    const params = {
      Bucket: CLOUDFLARE_BUCKETNAME,
      Key: `${randomFilename}`,
      ContentType: contentType,
      Metadata: {
        'x-amz-meta-file-hash': fileHash,
      },
    };

    const command = new CreateMultipartUploadCommand({ ...params });
    const response = await R2.send(command);
    return res.status(200).json({
      uploadId: response.UploadId,
      key: response.Key,
    });
  } catch (err) {
    console.log('Error', err);
    return res.status(500).json({ source: { status: 500 } });
  }
}

export async function prepareUploadParts(req: Request, res: Response) {
  const { partData } = req.body;

  const parts = partData.parts;

  const response = {
    presignedUrls: {},
  };

  for (const part of parts) {
    try {
      const params = {
        Bucket: CLOUDFLARE_BUCKETNAME,
        Key: partData.key,
        PartNumber: part.number,
        UploadId: partData.uploadId,
      };
      const command = new UploadPartCommand({ ...params });
      const url = await getSignedUrl(R2, command, { expiresIn: 3600 });

      // @ts-ignore
      response.presignedUrls[part.number] = url;
    } catch (err) {
      console.log('Error', err);
      return res.status(500).json(err);
    }
  }

  return res.status(200).json(response);
}

export async function listParts(req: Request, res: Response) {
  const { key, uploadId } = req.body;

  try {
    const params = {
      Bucket: CLOUDFLARE_BUCKETNAME,
      Key: key,
      UploadId: uploadId,
    };
    const command = new ListPartsCommand({ ...params });
    const response = await R2.send(command);

    return res.status(200).json(response['Parts']);
  } catch (err) {
    console.log('Error', err);
    return res.status(500).json(err);
  }
}

export async function completeMultipartUpload(req: Request, res: Response) {
  const { key, uploadId, parts } = req.body;

  try {
    const params = {
      Bucket: CLOUDFLARE_BUCKETNAME,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: parts },
    };

    const command = new CompleteMultipartUploadCommand({
      Bucket: CLOUDFLARE_BUCKETNAME,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: parts },
    });
    const response = await R2.send(command);
    response.Location =
      process.env.CLOUDFLARE_BUCKET_URL +
      '/' +
      response?.Location?.split('/').at(-1);
    return response;
  } catch (err) {
    console.log('Error', err);
    return res.status(500).json(err);
  }
}

export async function abortMultipartUpload(req: Request, res: Response) {
  const { key, uploadId } = req.body;

  try {
    const params = {
      Bucket: CLOUDFLARE_BUCKETNAME,
      Key: key,
      UploadId: uploadId,
    };
    const command = new AbortMultipartUploadCommand({ ...params });
    const response = await R2.send(command);

    return res.status(200).json(response);
  } catch (err) {
    console.log('Error', err);
    return res.status(500).json(err);
  }
}

export async function signPart(req: Request, res: Response) {
  const { key, uploadId } = req.body;
  const partNumber = parseInt(req.body.partNumber);

  try {
    const params = {
      Bucket: CLOUDFLARE_BUCKETNAME,
      Key: key,
      PartNumber: partNumber,
      UploadId: uploadId,
    };

    const command = new UploadPartCommand({ ...params });
    // Generate presigned URL without checksum requirements
    const url = await getSignedUrl(R2, command, { 
      expiresIn: 3600,
      // Don't include checksum in the presigned URL
      signableHeaders: new Set(['host']),
    });

    console.log(`[R2Uploader] Generated presigned URL for part ${partNumber} of ${key}`);
    
    return res.status(200).json({
      url: url,
    });
  } catch (err) {
    console.error('[R2Uploader] Error signing part:', err);
    return res.status(500).json({ error: 'Failed to sign part', details: err });
  }
}
