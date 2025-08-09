import AllCollectionsView from '@app/components/Settings/Collections/AllCollectionsView';
import useRouteGuard from '@app/hooks/useRouteGuard';
import { Permission } from '@app/hooks/useUser';
import type { NextPage } from 'next';

const AllCollectionsPage: NextPage = () => {
  useRouteGuard(Permission.ADMIN);
  return <AllCollectionsView />;
};

export default AllCollectionsPage;