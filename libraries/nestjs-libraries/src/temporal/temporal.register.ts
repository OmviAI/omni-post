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

      const neededAttributes = {
        organizationId: 6, // Keyword
        postId: 6, // Keyword (not Datetime!)
      };

      // Find attributes that are missing or have wrong type
      const attributesToAdd: Record<string, number> = {};
      for (const [attrName, expectedType] of Object.entries(neededAttributes)) {
        const existingType = customAttributes[attrName];
        if (!existingType || existingType !== expectedType) {
          attributesToAdd[attrName] = expectedType;
          if (existingType && existingType !== expectedType) {
            this.logger.warn(
              `Search attribute ${attrName} has wrong type ${existingType}, should be ${expectedType}. Will attempt to update.`
            );
          }
        }
      }

      if (Object.keys(attributesToAdd).length > 0) {
        // Note: Temporal doesn't support updating search attribute types directly.
        // If an attribute exists with wrong type, it needs to be removed first via Temporal CLI:
        // tctl admin cluster remove-search-attributes --search-attribute <name>
        // For now, we'll try to add them and log a warning if they already exist with wrong type
        try {
          await connection.operatorService.addSearchAttributes({
            namespace: process.env.TEMPORAL_NAMESPACE || 'default',
            searchAttributes: attributesToAdd,
          });
          this.logger.log(
            `Successfully registered search attributes: ${Object.keys(attributesToAdd).join(', ')}`
          );
        } catch (error: any) {
          if (error.message?.includes('already exists')) {
            this.logger.error(
              `Search attributes already exist with wrong type. Please remove them manually using Temporal CLI:\n` +
              `tctl admin cluster remove-search-attributes --search-attribute postId --search-attribute organizationId\n` +
              `Then restart the backend to re-register them with correct types.`
            );
          } else {
            throw error;
          }
        }
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
