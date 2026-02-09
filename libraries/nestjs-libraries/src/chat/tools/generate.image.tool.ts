import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';

const OMVI_IMAGE_API_URL =
  'https://omvi-aggre3-development.up.railway.app/aggre/images';

@Injectable()
export class GenerateImageTool implements AgentToolInterface {
  private storage = UploadFactory.createStorage();

  constructor(private _mediaService: MediaService) {}
  name = 'generateImageTool';

  run() {
    return createTool({
      id: 'generateImageTool',
      description: `Generate image to use in a post,
                    in case the user specified a platform that requires attachment and attachment was not provided,
                    ask if they want to generate a picture of a video.
      `,
      inputSchema: z.object({
        prompt: z.string(),
      }),
      outputSchema: z.object({
        id: z.string(),
        path: z.string(),
      }),
      execute: async (args, options) => {
        const { context, runtimeContext } = args;
        checkAuth(args, options);
        // @ts-ignore
        const org = JSON.parse(runtimeContext.get('organization') as string);

        console.log(`[GenerateImageTool] ========== IMAGE GENERATION START ==========`);
        console.log(`[GenerateImageTool] Endpoint: ${OMVI_IMAGE_API_URL}`);
        console.log(`[GenerateImageTool] Prompt: ${context.prompt}`);
        console.log(`[GenerateImageTool] Provider: openrouter`);
        console.log(`[GenerateImageTool] Model: google/gemini-2.5-flash-image`);
        console.log(`[GenerateImageTool] Aspect Ratio: 16:9`);

        // Call the Omvi image generation endpoint
        const formData = new FormData();
        formData.append('prompt', context.prompt);
        formData.append('provider', 'openrouter');
        formData.append('model', 'google/gemini-2.5-flash-image');
        formData.append('aspect_ratio', '16:9');

        console.log(`[GenerateImageTool] Sending request to: ${OMVI_IMAGE_API_URL}...`);
        const response = await fetch(OMVI_IMAGE_API_URL, {
          method: 'POST',
          body: formData,
        });
        console.log(`[GenerateImageTool] Response status: ${response.status} ${response.statusText}`);

        if (!response.ok) {
          const errorText = await response.text();
          console.error(
            `[GenerateImageTool] API error: ${response.status} ${response.statusText}`,
            errorText
          );
          throw new Error(
            `Image generation failed: ${response.status} ${response.statusText}`
          );
        }

        const contentType = response.headers.get('content-type') || '';
        let imageUrl: string | undefined;

        if (contentType.includes('application/json')) {
          const result = await response.json();
          console.log(`[GenerateImageTool] API JSON response keys:`, Object.keys(result));
          // Handle various possible response formats
          imageUrl =
            result.url ||
            result.image ||
            result.imageUrl ||
            result.data?.url ||
            result.data?.image;

          // Handle `images` array format (Omvi API returns this)
          if (!imageUrl && Array.isArray(result.images) && result.images.length > 0) {
            imageUrl = result.images[0];
          }

          if (!imageUrl && result.data && typeof result.data === 'string') {
            // If data is a base64 string
            imageUrl = `data:image/png;base64,${result.data}`;
          }
        } else if (contentType.includes('image/')) {
          // Direct binary image response
          const buffer = Buffer.from(await response.arrayBuffer());
          const base64 = buffer.toString('base64');
          imageUrl = `data:${contentType};base64,${base64}`;
        } else {
          // Try to parse as JSON anyway
          const text = await response.text();
          try {
            const result = JSON.parse(text);
            imageUrl =
              result.url ||
              result.image ||
              result.imageUrl ||
              result.data?.url;
          } catch {
            throw new Error(`Unexpected response format: ${contentType}`);
          }
        }

        if (!imageUrl) {
          console.error(`[GenerateImageTool] ERROR: No image URL found in API response`);
          throw new Error('No image URL found in API response');
        }

        const isBase64 = imageUrl.startsWith('data:');
        console.log(`[GenerateImageTool] imageUrl type: ${isBase64 ? 'base64 data URI' : 'URL'}`);
        console.log(`[GenerateImageTool] imageUrl (first 150 chars): ${imageUrl.substring(0, 150)}...`);
        console.log(`[GenerateImageTool] imageUrl length: ${imageUrl.length}`);

        // Upload to our storage
        const file = await this.storage.uploadSimple(imageUrl);
        console.log(`[GenerateImageTool] Image uploaded to storage: ${file}`);

        const saved = await this._mediaService.saveFile(
          org.id,
          file.split('/').pop()!,
          file
        );
        console.log(`[GenerateImageTool] File saved to database:`, saved);
        return saved;
      },
    });
  }
}
