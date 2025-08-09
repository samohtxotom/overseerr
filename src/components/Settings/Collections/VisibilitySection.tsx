import React from 'react';
import { Field } from 'formik';
import { defineMessages, useIntl } from 'react-intl';

const messages = defineMessages({
  visibility: 'Visibility',
  visibilityDescription: 'Control where this collection appears in Plex',
  usersHome: 'Users Home',
  usersHomeDescription: 'Show on user home screens',
  serverOwnerHome: 'Server Owner Home',
  serverOwnerHomeDescription: 'Show on server owner home screen',
  libraryRecommended: 'Library Recommended',
  libraryRecommendedDescription: 'Show in library recommended section',
  libraryTabOnly: 'Library Tab Only',
  libraryTabOnlyDescription: 'Only show in the library tab, not on home screens',
  inactiveVisibility: 'Inactive Visibility Settings',
  inactiveVisibilityDescription: 'Control visibility when collection is inactive (during time restrictions)',
});

interface CheckboxState {
  enabled: boolean;
  label: string;
}

interface VisibilitySectionProps {
  values: any;
  setFieldValue: (field: string, value: any) => void;
  isEnhancedForm?: boolean;
  isDefaultPlexHub?: boolean;
  fieldPrefix?: string; // For nested fields like 'timeRestriction.inactiveVisibilityConfig'
  titleKey?: string; // Custom title message key
  descriptionKey?: string; // Custom description message key
}

const VisibilitySection = ({
  values,
  setFieldValue,
  isEnhancedForm = false,
  isDefaultPlexHub = false,
  fieldPrefix = 'visibilityConfig',
  titleKey = 'visibility',
  descriptionKey = 'visibilityDescription'
}: VisibilitySectionProps) => {
  const intl = useIntl();

  // Get current visibility config
  const visibilityConfig = fieldPrefix.includes('.') 
    ? fieldPrefix.split('.').reduce((obj, key) => obj?.[key], values)
    : values[fieldPrefix];

  // Define checkbox states with labels and enabled status
  const checkboxStates: Record<string, CheckboxState> = {
    usersHome: {
      enabled: true,
      label: intl.formatMessage(messages.usersHome),
    },
    serverOwnerHome: {
      enabled: true,
      label: intl.formatMessage(messages.serverOwnerHome),
    },
    libraryRecommended: {
      enabled: true,
      label: intl.formatMessage(messages.libraryRecommended),
    },
  };

  const renderCheckbox = (key: string, checkboxState: CheckboxState) => {
    const fieldName = `${fieldPrefix}.${key}`;
    const isDisabled = !checkboxState.enabled || visibilityConfig?.libraryTabOnly;

    return (
      <div key={key} className="flex items-center">
        <Field
          type="checkbox"
          id={`${fieldPrefix}-${key}`}
          name={fieldName}
          disabled={isDisabled}
          className={`form-checkbox ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        />
        <label
          htmlFor={`${fieldPrefix}-${key}`}
          className={`ml-2 text-sm ${isDisabled ? 'text-gray-500' : 'text-gray-300'}`}
        >
          {checkboxState.label}
        </label>
      </div>
    );
  };

  return (
    <div>
      <label className="block text-sm font-medium text-gray-300 mb-2">
        {intl.formatMessage(messages[titleKey as keyof typeof messages] || messages.visibility)}
      </label>
      
      <div className="space-y-3 p-4 bg-gray-800 border border-gray-600 rounded-md">
        <p className="text-xs text-gray-400 mb-3">
          {intl.formatMessage(messages[descriptionKey as keyof typeof messages] || messages.visibilityDescription)}
        </p>

        <div className="space-y-2">
          {Object.entries(checkboxStates).map(([key, state]) => 
            renderCheckbox(key, state)
          )}
          
          {/* Library Tab Only - not available for default Plex hubs */}
          {!isDefaultPlexHub && (
            <div className="flex items-center pt-2 border-t border-gray-600">
              <Field
                type="checkbox"
                id={`${fieldPrefix}-libraryTabOnly`}
                name={`${fieldPrefix}.libraryTabOnly`}
                className="form-checkbox"
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  const isChecked = e.target.checked;
                  setFieldValue(`${fieldPrefix}.libraryTabOnly`, isChecked);
                  
                  // If library tab only is enabled, disable home screen options
                  if (isChecked) {
                    setFieldValue(`${fieldPrefix}.usersHome`, false);
                    setFieldValue(`${fieldPrefix}.serverOwnerHome`, false);
                    // Keep library recommended enabled as it makes sense with library tab only
                  }
                }}
              />
              <label
                htmlFor={`${fieldPrefix}-libraryTabOnly`}
                className="ml-2 text-sm text-gray-300"
              >
                {intl.formatMessage(messages.libraryTabOnly)}
              </label>
            </div>
          )}
        </div>

        {/* Helper text for Library Tab Only */}
        {visibilityConfig?.libraryTabOnly && (
          <div className="mt-3 p-2 bg-blue-500/10 border border-blue-500/20 rounded text-xs text-blue-300">
            📚 Library Tab Only mode: Collection will only appear in the library tab, not on any home screens.
          </div>
        )}

        {/* Warning when no visibility options are selected */}
        {!visibilityConfig?.usersHome && 
         !visibilityConfig?.serverOwnerHome && 
         !visibilityConfig?.libraryRecommended && 
         !visibilityConfig?.libraryTabOnly && (
          <div className="mt-3 p-2 bg-yellow-500/10 border border-yellow-500/20 rounded text-xs text-yellow-300">
            ⚠️ No visibility options selected. Collection will be hidden from all users.
          </div>
        )}
      </div>
    </div>
  );
};

export default VisibilitySection;