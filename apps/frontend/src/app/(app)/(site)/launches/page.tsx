export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { isGeneralServerSide } from '@gitroom/helpers/utils/is.general.server.side';
import { LaunchesGuard } from '@gitroom/frontend/components/launches/launches.guard';

export const metadata: Metadata = {
  title: `${isGeneralServerSide() ? 'Prism Calendar' : 'Gitroom Launches'}`,
  description: '',
};

export default async function Index() {
  // The LaunchesGuard component handles:
  // - Reading Clerk data from URL params (userId, email, name, token, ...)
  // - Persisting it to localStorage
  // - Ensuring that only users with a stored session can see Launches
  return <LaunchesGuard />;
}
