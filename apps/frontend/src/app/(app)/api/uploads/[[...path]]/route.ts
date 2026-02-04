import { NextRequest, NextResponse } from 'next/server';
import { createReadStream, statSync } from 'fs';
// @ts-ignore
import mime from 'mime';
async function* nodeStreamToIterator(stream: any) {
  for await (const chunk of stream) {
    yield chunk;
  }
}
function iteratorToStream(iterator: any) {
  return new ReadableStream({
    async pull(controller) {
      const { value, done } = await iterator.next();
      if (done) {
        controller.close();
      } else {
        controller.enqueue(new Uint8Array(value));
      }
    },
  });
}
export const GET = async (
  request: NextRequest,
  context: {
    params: {
      path: string[];
    };
  }
) => {
  try {
    const filePath = context.params.path.join('/');
    
    // In production/deployed environments, if UPLOAD_DIRECTORY is not accessible,
    // proxy the request to the backend service
    const uploadDir = process.env.UPLOAD_DIRECTORY;
    const backendUrl = process.env.BACKEND_INTERNAL_URL || process.env.NEXT_PUBLIC_BACKEND_URL;
    
    // If no upload directory is set but we have backend URL, proxy to backend
    if (!uploadDir && backendUrl && process.env.NODE_ENV === 'production') {
      console.log(`[Upload Route] Proxying to backend: ${backendUrl}/public/uploads/${filePath}`);
      const backendResponse = await fetch(`${backendUrl}/public/uploads/${filePath}`);
      
      if (!backendResponse.ok) {
        return new NextResponse('File not found', { status: backendResponse.status });
      }
      
      const contentType = backendResponse.headers.get('content-type') || 'application/octet-stream';
      const contentLength = backendResponse.headers.get('content-length');
      
      return new Response(backendResponse.body, {
        headers: {
          'Content-Type': contentType,
          ...(contentLength ? { 'Content-Length': contentLength } : {}),
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
    }
    
    // Local filesystem access (development or when UPLOAD_DIRECTORY is set)
    let uploadDirectory = uploadDir;
    if (!uploadDirectory) {
      // Fallback: construct path relative to project root (for monorepo setup)
      const path = require('path');
      uploadDirectory = path.resolve(process.cwd(), 'apps/backend/uploads');
      console.warn(`[Upload Route] UPLOAD_DIRECTORY not set, using fallback: ${uploadDirectory}`);
    }

    const fullFilePath = uploadDirectory + '/' + filePath;
    
    // Check if file exists
    if (!statSync(fullFilePath).isFile()) {
      console.error(`[Upload Route] File not found: ${fullFilePath}`);
      return new NextResponse('File not found', { status: 404 });
    }

    const response = createReadStream(fullFilePath);
    const fileStats = statSync(fullFilePath);
    const contentType = mime.getType(fullFilePath) || 'application/octet-stream';
    const iterator = nodeStreamToIterator(response);
    const webStream = iteratorToStream(iterator);
    
    return new Response(webStream, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': fileStats.size.toString(),
        'Last-Modified': fileStats.mtime.toUTCString(),
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (error: any) {
    console.error('[Upload Route] Error serving file:', error);
    if (error.code === 'ENOENT') {
      return new NextResponse('File not found', { status: 404 });
    }
    return new NextResponse('Internal server error', { status: 500 });
  }
};
