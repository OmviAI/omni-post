import {
  Global,
  Injectable,
  Logger,
  Module,
  OnModuleInit,
} from '@nestjs/common';
import { TemporalService } from 'nestjs-temporal-core';
import { Connection } from '@temporalio/client';

@Injectable()
export class TemporalRegister implements OnModuleInit {
  private readonly logger = new Logger(TemporalRegister.name);

  constructor(private _client: TemporalService) {}

  async onModuleInit(): Promise<void> {
    try {
      const connection = this._client?.client?.getRawClient()
        ?.connection as Connection;

      if (!connection) {
        this.logger.warn('Temporal connection not available, skipping search attribute registration');
        return;
      }

      const { customAttributes } =
        await connection.operatorService.listSearchAttributes({
          namespace: process.env.TEMPORAL_NAMESPACE || 'default',
        });

      const neededAttribute = ['organizationId', 'postId'];
      const missingAttributes = neededAttribute.filter(
        (attr) => !customAttributes[attr],
      );

      if (missingAttributes.length > 0) {
        // Use Keyword (2) instead of Text (1) to avoid the 3 Text attribute limit
        // Keyword is better for exact matches on IDs anyway
        await connection.operatorService.addSearchAttributes({
          namespace: process.env.TEMPORAL_NAMESPACE || 'default',
          searchAttributes: missingAttributes.reduce((all, current) => {
            // @ts-ignore
            // Type 2 = Keyword (for exact matches, better for IDs)
            // Type 1 = Text (limited to 3 per namespace in self-hosted Temporal)
            // Type 6 = Datetime (NOT what we want for IDs!)
            all[current] = 2;  // FIXED: was 6 (Datetime), now 2 (Keyword)
            return all;
          }, {}),
        });
        this.logger.log(
          `Successfully registered search attributes: ${missingAttributes.join(', ')}`
        );
      }
    } catch (error: any) {
      // Make this non-blocking - if search attributes fail to register,
      // the app should still start (they may already exist or Temporal may be unavailable)
      this.logger.warn(
        `Failed to register Temporal search attributes: ${error.message}. This is non-critical and the app will continue.`
      );
    }
  }
}

@Global()
@Module({
  imports: [],
  controllers: [],
  providers: [TemporalRegister],
  get exports() {
    return this.providers;
  },
})
export class TemporalRegisterMissingSearchAttributesModule {}
