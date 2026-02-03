import { PostActivity } from '@gitroom/orchestrator/activities/post.activity';
import {
  ActivityFailure,
  ApplicationFailure,
  startChild,
  proxyActivities,
  sleep,
  defineSignal,
  setHandler,
} from '@temporalio/workflow';
import dayjs from 'dayjs';
import { Integration } from '@prisma/client';
import { capitalize, sortBy } from 'lodash';
import { PostResponse } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { TypedSearchAttributes } from '@temporalio/common';
import { postId as postIdSearchParam } from '@gitroom/nestjs-libraries/temporal/temporal.search.attribute';

const proxyTaskQueue = (taskQueue: string) => {
  return proxyActivities<PostActivity>({
    startToCloseTimeout: '10 minute',
    taskQueue,
    retry: {
      maximumAttempts: 3,
      backoffCoefficient: 1,
      initialInterval: '2 minutes',
    },
  });
};

const {
  getPostsList,
  inAppNotification,
  changeState,
  updatePost,
  sendWebhooks,
  isCommentable,
} = proxyActivities<PostActivity>({
  startToCloseTimeout: '10 minute',
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 1,
    initialInterval: '2 minutes',
  },
});

const poke = defineSignal('poke');

const iterate = ['post', 'afterRefresh', 'retry1', 'retry2', 'retry3'];

export async function postWorkflowV101({
  taskQueue,
  postId,
  organizationId,
  postNow = false,
}: {
  taskQueue: string;
  postId: string;
  organizationId: string;
  postNow?: boolean;
}) {
  console.log(`[Workflow] postWorkflowV101 started - PostId: ${postId}, OrgId: ${organizationId}, TaskQueue: ${taskQueue}, PostNow: ${postNow}`);
  
  // Dynamic task queue, for concurrency
  const {
    postSocial,
    postComment,
    getIntegrationById,
    refreshToken,
    internalPlugs,
    globalPlugs,
    processInternalPlug,
    processPlug,
  } = proxyTaskQueue(taskQueue);

  let poked = false;
  setHandler(poke, () => {
    poked = true;
  });

  const startTime = new Date();
  // get all the posts and comments to post
  const postsList = await getPostsList(organizationId, postId);
  const [post] = postsList;

  console.log(`[Workflow] Retrieved posts - PostId: ${postId}, PostsCount: ${postsList.length}, PostExists: ${!!post}, PostState: ${post?.state}, PostNow: ${postNow}`);

  // in case doesn't exists for some reason, fail it
  if (!post || (!postNow && post.state !== 'QUEUE')) {
    console.log(`[Workflow] Early return - PostId: ${postId}, Reason: ${!post ? 'Post not found' : 'Post state is not QUEUE'}`);
    return;
  }

  // if it's a repeatable post, we should ignore this.
  if (!postNow) {
    await sleep(
      dayjs(post.publishDate).isBefore(dayjs())
        ? 0
        : dayjs(post.publishDate).diff(dayjs(), 'millisecond')
    );
  }

  // if refresh is needed from last time, let's inform the user
  if (post.integration?.refreshNeeded) {
    console.log(`[Workflow] Refresh needed - PostId: ${postId}, Provider: ${post.integration?.providerIdentifier}, IntegrationName: ${post?.integration?.name}`);
    await inAppNotification(
      post.organizationId,
      `We couldn't post to ${post.integration?.providerIdentifier} for ${post?.integration?.name}`,
      `We couldn't post to ${post.integration?.providerIdentifier} for ${post?.integration?.name} because you need to reconnect it. Please enable it and try again.`,
      true,
      false,
      'info'
    );
    return;
  }

  // if it's disabled, inform the user
  if (post.integration?.disabled) {
    console.log(`[Workflow] Integration disabled - PostId: ${postId}, Provider: ${post.integration?.providerIdentifier}, IntegrationName: ${post?.integration?.name}`);
    await inAppNotification(
      post.organizationId,
      `We couldn't post to ${post.integration?.providerIdentifier} for ${post?.integration?.name}`,
      `We couldn't post to ${post.integration?.providerIdentifier} for ${post?.integration?.name} because it's disabled. Please enable it and try again.`,
      true,
      false,
      'info'
    );
    return;
  }

  console.log(`[Workflow] Integration check passed - PostId: ${postId}, Provider: ${post.integration?.providerIdentifier}, IntegrationId: ${post.integration?.id}, HasToken: ${!!post.integration?.token}`);

  // Do we need to post comment for this social?
  const toComment =
    postsList.length === 1 ? false : await isCommentable(post.integration);

  // list of all the saved results
  const postsResults: PostResponse[] = [];

  // iterate over the posts
  for (let i = 0; i < postsList.length; i++) {
    // this is a small trick to repeat an action in case of token refresh
    for (const _ of iterate) {
      try {
        // first post the main post
        if (i === 0) {
          console.log(`[Workflow] Calling postSocial - PostId: ${postId}, PostIndex: ${i}, IntegrationId: ${post.integration?.id}, Provider: ${post.integration?.providerIdentifier}`);
          const socialResults = await postSocial(post.integration as Integration, [
            postsList[i],
          ]);
          console.log(`[Workflow] postSocial completed - PostId: ${postId}, ResultsCount: ${socialResults?.length || 0}, Results: ${JSON.stringify(socialResults)}`);
          postsResults.push(...socialResults);

          // then post the comments if any
        } else {
          if (!toComment) {
            break;
          }

          if (postsList[i].delay) {
            await sleep(60000 * postsList[i].delay);
          }

          postsResults.push(
            ...(await postComment(
              postsResults[0].postId,
              postsResults.length === 1
                ? undefined
                : postsResults[i - 1].postId,
              post.integration,
              [postsList[i]]
            ))
          );
        }

        // mark post as successful
        console.log(`[Workflow] Updating post - PostId: ${postId}, ResultPostId: ${postsResults[i]?.postId}, ReleaseURL: ${postsResults[i]?.releaseURL}`);
        await updatePost(
          postsList[i].id,
          postsResults[i].postId,
          postsResults[i].releaseURL
        );
        console.log(`[Workflow] Post updated successfully - PostId: ${postId}`);

        if (i === 0) {
          // send notification on a sucessful post
          console.log(`[Workflow] Sending success notification - PostId: ${postId}, ReleaseURL: ${postsResults[0].releaseURL}`);
          await inAppNotification(
            post.integration.organizationId,
            `Your post has been published on ${capitalize(
              post.integration.providerIdentifier
            )}`,
            `Your post has been published on ${capitalize(
              post.integration.providerIdentifier
            )} at ${postsResults[0].releaseURL}`,
            true,
            true
          );
          console.log(`[Workflow] Success notification sent - PostId: ${postId}`);
        }

        // break the current while to move to the next post
        break;
      } catch (err) {
        console.error(`[Workflow] ERROR in post loop - PostId: ${postId}, PostIndex: ${i}, Error: ${err instanceof Error ? err.message : err}, ErrorType: ${err instanceof ActivityFailure ? 'ActivityFailure' : typeof err}, Stack: ${err instanceof Error ? err.stack : 'N/A'}`);
        
        // if token refresh is needed, do it and repeat
        if (
          err instanceof ActivityFailure &&
          err.cause instanceof ApplicationFailure &&
          err.cause.type === 'refresh_token'
        ) {
          console.log(`[Workflow] Token refresh needed - PostId: ${postId}, Attempting refresh...`);
          const refresh = await refreshToken(post.integration);
          if (!refresh || !refresh.accessToken) {
            console.error(`[Workflow] Token refresh failed - PostId: ${postId}, Changing state to ERROR`);
            await changeState(postsList[0].id, 'ERROR', err, postsList);
            return false;
          }

          console.log(`[Workflow] Token refreshed successfully - PostId: ${postId}, Retrying...`);
          post.integration.token = refresh.accessToken;
          continue;
        }

        // for other errors, change state and inform the user if needed
        console.error(`[Workflow] Changing post state to ERROR - PostId: ${postId}, Error: ${err instanceof Error ? err.message : err}`);
        await changeState(postsList[0].id, 'ERROR', err, postsList);

        // specific case for bad body errors
        if (
          err instanceof ActivityFailure &&
          err.cause instanceof ApplicationFailure &&
          err.cause.type === 'bad_body'
        ) {
          await inAppNotification(
            post.organizationId,
            `Error posting${i === 0 ? ' ' : ' comments '}on ${
              post.integration?.providerIdentifier
            } for ${post?.integration?.name}`,
            `An error occurred while posting${i === 0 ? ' ' : ' comments '}on ${
              post.integration?.providerIdentifier
            }${err?.cause?.message ? `: ${err?.cause?.message}` : ``}`,
            true,
            false,
            'fail'
          );
          return false;
        }
      }
    }
  }

  // send webhooks for the post
  await sendWebhooks(
    postsResults[0].postId,
    post.organizationId,
    post.integration.id
  );

  // load internal plugs like repost by other users
  const internalPlugsList = await internalPlugs(
    post.integration,
    JSON.parse(post.settings)
  );

  // load global plugs, like repost a post if it gets to a certain number of likes
  const globalPlugsList = (await globalPlugs(post.integration)).reduce(
    (all, current) => {
      for (let i = 1; i <= current.totalRuns; i++) {
        all.push({
          ...current,
          delay: current.delay * i,
        });
      }

      return all;
    },
    []
  );

  // Check if the post is repeatable
  const repeatPost = !post.intervalInDays
    ? []
    : [
        {
          type: 'repeat-post',
          delay:
            post.intervalInDays * 24 * 60 * 60 * 1000 -
            (new Date().getTime() - startTime.getTime()),
        },
      ];

  // Sort all the actions by delay, so we can process them in order
  const list = sortBy(
    [...internalPlugsList, ...globalPlugsList, ...repeatPost],
    'delay'
  );

  // process all the plugs in order, we are using while because in some cases we need to remove items from the list
  while (list.length > 0) {
    // get the next to process
    const todo = list.shift();

    // wait for the delay
    await sleep(todo.delay);

    // process internal plug
    if (todo.type === 'internal-plug') {
      for (const _ of iterate) {
        try {
          await processInternalPlug({ ...todo, post: postsResults[0].postId });
        } catch (err) {
          if (
            err instanceof ActivityFailure &&
            err.cause instanceof ApplicationFailure &&
            err.cause.type === 'refresh_token'
          ) {
            const refresh = await refreshToken(
              await getIntegrationById(organizationId, todo.integration)
            );
            if (!refresh || !refresh.accessToken) {
              break;
            }

            continue;
          }

          if (
            err instanceof ActivityFailure &&
            err.cause instanceof ApplicationFailure &&
            err.cause.type === 'bad_body'
          ) {
            break;
          }

          continue;
        }
        break;
      }
    }

    // process global plug
    if (todo.type === 'global') {
      for (const _ of iterate) {
        try {
          const process = await processPlug({
            ...todo,
            postId: postsResults[0].postId,
          });
          if (process) {
            const toDelete = list
              .reduce((all, current, index) => {
                if (current.plugId === todo.plugId) {
                  all.push(index);
                }

                return all;
              }, [])
              .reverse();

            for (const index of toDelete) {
              list.splice(index, 1);
            }
          }
        } catch (err) {
          if (
            err instanceof ActivityFailure &&
            err.cause instanceof ApplicationFailure &&
            err.cause.type === 'refresh_token'
          ) {
            const refresh = await refreshToken(post.integration);
            if (!refresh || !refresh.accessToken) {
              break;
            }

            continue;
          }

          if (
            err instanceof ActivityFailure &&
            err.cause instanceof ApplicationFailure &&
            err.cause.type === 'bad_body'
          ) {
            break;
          }

          continue;
        }

        break;
      }
    }

    // process repeat post in a new workflow, this is important so the other plugs can keep running
    if (todo.type === 'repeat-post') {
      await startChild(postWorkflowV101, {
        parentClosePolicy: 'ABANDON',
        args: [
          {
            taskQueue,
            postId,
            organizationId,
            postNow: true,
          },
        ],
        workflowId: `post_${post.id}_${makeId(10)}`,
        typedSearchAttributes: new TypedSearchAttributes([
          {
            key: postIdSearchParam,
            value: postId,
          },
        ]),
      });
    }
  }
}
