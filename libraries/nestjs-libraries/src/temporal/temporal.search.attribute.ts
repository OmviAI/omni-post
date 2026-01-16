import {
  defineSearchAttributeKey,
  SearchAttributeType,
} from '@temporalio/common';

// Changed from TEXT to KEYWORD to avoid the 3 Text attribute limit in self-hosted Temporal
// KEYWORD is better for exact ID matches anyway
export const organizationId = defineSearchAttributeKey(
  'organizationId',
  SearchAttributeType.KEYWORD
);

export const postId = defineSearchAttributeKey(
  'postId',
  SearchAttributeType.KEYWORD
);
