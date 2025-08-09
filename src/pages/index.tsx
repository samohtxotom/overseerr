import type { NextPage } from 'next';
import { Permission, useUser } from '@app/hooks/useUser';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import { defineMessages, useIntl } from 'react-intl';
import CollectionSettings from '@app/components/Settings/Collections/CollectionSettings';
import useSWR from 'swr';
import type { PlexSettings } from '@server/lib/settings';
import type { CollectionConfig } from '@app/components/Settings/Collections/types';

const messages = defineMessages({
  homeTitle: 'Home',
  homeDescription: 'Manage your Plex collections and home screen settings',
});

const Index: NextPage = () => {
  const intl = useIntl();
  const { user, hasPermission } = useUser();
  
  const { data: plexSettings, mutate: revalidatePlex } = useSWR<PlexSettings>('/api/v1/settings/plex');
  const { data: libraries = [] } = useSWR('/api/v1/settings/plex/libraries');

  if (!user) {
    return <LoadingSpinner />;
  }

  // Show different content based on permissions
  const isAdmin = hasPermission(Permission.ADMIN);
  
  if (!isAdmin) {
    // For non-admin users, show welcome message
    return (
      <>
        <PageTitle title={intl.formatMessage(messages.homeTitle)} />
        <div className="mb-8">
          <h3 className="heading text-white">
            {intl.formatMessage(messages.homeTitle)}
          </h3>
          <p className="description">
            Welcome! Discover movies and TV shows to request.
          </p>
        </div>
        <div className="text-center">
          <a href="/discover" className="text-indigo-500 hover:text-indigo-400">
            Go to Discover →
          </a>
        </div>
      </>
    );
  }

  if (!plexSettings || !libraries) {
    return <LoadingSpinner />;
  }

  const collectionConfigs = plexSettings.collectionConfigs || [];

  const handleUpdateConfigs = async (newConfigs: CollectionConfig[]) => {
    await revalidatePlex();
  };

  return (
    <>
      <PageTitle title={intl.formatMessage(messages.homeTitle)} />
      <div className="mb-8">
        <h3 className="heading text-white">
          {intl.formatMessage(messages.homeTitle)}
        </h3>
        <p className="description">
          {intl.formatMessage(messages.homeDescription)}
        </p>
      </div>
      
      <CollectionSettings
        collectionConfigs={collectionConfigs}
        libraries={libraries}
        onUpdateConfigs={handleUpdateConfigs}
      />
    </>
  );
};

export default Index;
