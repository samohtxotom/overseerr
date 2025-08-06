import { useState } from 'react';
import { useIntl, defineMessages } from 'react-intl';
import { Transition } from '@headlessui/react';
import Modal from '@app/components/Common/Modal';
import globalMessages from '@app/i18n/globalMessages';
import type { CollectionConfig } from './types';

const messages = defineMessages({
  editHubConfiguration: 'Edit Plex Hub Configuration',
  hubName: 'Hub Name',
  visibility: 'Visibility',
  usersHome: 'Users Home',
  serverOwnerHome: 'Server Owner Home',
  libraryRecommended: 'Library Recommended',
  save: 'Save',
  visibilityDescription: 'Control where this Plex hub appears for different user groups.',
  hubDescription: 'This is a built-in Plex hub. Only visibility settings can be modified.',
});

interface HubConfigFormProps {
  config: CollectionConfig;
  onSave: (config: CollectionConfig) => void;
  onCancel: () => void;
}

const HubConfigForm = ({ config, onSave, onCancel }: HubConfigFormProps) => {
  const intl = useIntl();
  const [formData, setFormData] = useState(config);

  const handleVisibilityChange = (field: keyof typeof config.visibilityConfig, value: boolean) => {
    setFormData(prev => ({
      ...prev,
      visibilityConfig: {
        ...prev.visibilityConfig,
        [field]: value,
      },
    }));
  };

  const handleSave = () => {
    onSave(formData);
  };

  return (
    <Transition
      appear={true}
      show={true}
      enter="transition duration-300"
      enterFrom="opacity-0 scale-75"
      enterTo="opacity-100 scale-100"
      leave="transition duration-300"
      leaveFrom="opacity-100 scale-100"
      leaveTo="opacity-0 scale-75"
    >
      <Modal
        onCancel={onCancel}
        title={intl.formatMessage(messages.editHubConfiguration)}
        okButtonType="primary"
        okText={intl.formatMessage(messages.save)}
        cancelText={intl.formatMessage(globalMessages.cancel)}
        onOk={handleSave}
        subTitle={intl.formatMessage(messages.hubDescription)}
      >
      <div className="space-y-6">
        {/* Hub Information (Read-only) */}
        <div className="rounded-lg border border-orange-500/20 bg-orange-900/10 p-4">
          <div className="flex items-center space-x-2 mb-2">
            <div className="h-2 w-2 bg-orange-400 rounded-full"></div>
            <h3 className="text-sm font-medium text-orange-300">Plex Hub Information</h3>
          </div>
          <div className="space-y-2 text-sm">
            <div>
              <span className="text-gray-400">Name:</span>
              <span className="ml-2 text-white">{config.name}</span>
            </div>
            <div>
              <span className="text-gray-400">Type:</span>
              <span className="ml-2 text-white">{config.subtype?.replace(/\./g, ' → ')}</span>
            </div>
            <div>
              <span className="text-gray-400">Library:</span>
              <span className="ml-2 text-white">{config.libraryName}</span>
            </div>
            <div>
              <span className="text-gray-400">Media Type:</span>
              <span className="ml-2 text-white capitalize">{config.mediaType}</span>
            </div>
          </div>
        </div>

        {/* Visibility Configuration */}
        <div>
          <div className="mb-4">
            <h3 className="text-base font-medium text-white mb-1">
              {intl.formatMessage(messages.visibility)}
            </h3>
            <p className="text-sm text-gray-400">
              {intl.formatMessage(messages.visibilityDescription)}
            </p>
          </div>

          <div className="space-y-3">
            <label className="flex items-center space-x-3">
              <input
                type="checkbox"
                checked={formData.visibilityConfig?.usersHome || false}
                onChange={(e) => handleVisibilityChange('usersHome', e.target.checked)}
                className="form-checkbox h-4 w-4 text-indigo-600 bg-gray-700 border-gray-600 rounded focus:ring-indigo-500 focus:ring-offset-gray-800"
              />
              <div>
                <span className="text-sm font-medium text-white">
                  {intl.formatMessage(messages.usersHome)}
                </span>
                <p className="text-xs text-gray-400">Show on user home screens</p>
              </div>
            </label>

            <label className="flex items-center space-x-3">
              <input
                type="checkbox"
                checked={formData.visibilityConfig?.serverOwnerHome || false}
                onChange={(e) => handleVisibilityChange('serverOwnerHome', e.target.checked)}
                className="form-checkbox h-4 w-4 text-indigo-600 bg-gray-700 border-gray-600 rounded focus:ring-indigo-500 focus:ring-offset-gray-800"
              />
              <div>
                <span className="text-sm font-medium text-white">
                  {intl.formatMessage(messages.serverOwnerHome)}
                </span>
                <p className="text-xs text-gray-400">Show on server owner home screen</p>
              </div>
            </label>

            <label className="flex items-center space-x-3">
              <input
                type="checkbox"
                checked={formData.visibilityConfig?.libraryRecommended || false}
                onChange={(e) => handleVisibilityChange('libraryRecommended', e.target.checked)}
                className="form-checkbox h-4 w-4 text-indigo-600 bg-gray-700 border-gray-600 rounded focus:ring-indigo-500 focus:ring-offset-gray-800"
              />
              <div>
                <span className="text-sm font-medium text-white">
                  {intl.formatMessage(messages.libraryRecommended)}
                </span>
                <p className="text-xs text-gray-400">Show in library recommended section</p>
              </div>
            </label>

          </div>
        </div>
      </div>
    </Modal>
    </Transition>
  );
};

export default HubConfigForm;