import React, { useState } from 'react';
import { Field, ErrorMessage } from 'formik';
import { defineMessages, useIntl } from 'react-intl';

const messages = defineMessages({
  customTraktListUrl: 'Custom Trakt List URL',
  customTmdbCollectionUrl: 'Custom TMDb Collection URL',
  customImdbListUrl: 'Custom IMDb List URL',
  customLetterboxdListUrl: 'Custom Letterboxd List URL',
  fetchTitle: 'Fetch Title',
  fetching: 'Fetching...',
  fetchedTitle: 'Fetched Title',
  enterUrl: 'Enter URL...',
  urlRequired: 'URL is required for custom lists',
  validUrl: 'Please enter a valid URL',
});

interface CustomUrlSectionProps {
  values: any;
  setFieldValue: (field: string, value: any) => void;
  errors: any;
  fetchTraktTitle?: (url: string, setFieldValue?: (field: string, value: any) => void) => Promise<void>;
  fetchTmdbTitle?: (url: string, setFieldValue?: (field: string, value: any) => void) => Promise<void>;
  fetchImdbTitle?: (url: string, setFieldValue?: (field: string, value: any) => void) => Promise<void>;
  fetchLetterboxdTitle?: (url: string, setFieldValue?: (field: string, value: any) => void) => Promise<void>;
}

const CustomUrlSection = ({
  values,
  setFieldValue,
  errors,
  fetchTraktTitle,
  fetchTmdbTitle,
  fetchImdbTitle,
  fetchLetterboxdTitle
}: CustomUrlSectionProps) => {
  const intl = useIntl();
  const [isLoadingTitle, setIsLoadingTitle] = useState({
    trakt: false,
    tmdb: false,
    imdb: false,
    letterboxd: false
  });

  const handleFetchTitle = async (type: 'trakt' | 'tmdb' | 'imdb' | 'letterboxd') => {
    const urlField = `${type}CustomListUrl`;
    const url = values[urlField];
    
    if (!url) return;

    setIsLoadingTitle(prev => ({ ...prev, [type]: true }));
    
    try {
      const fetchFunction = {
        trakt: fetchTraktTitle,
        tmdb: fetchTmdbTitle,
        imdb: fetchImdbTitle,
        letterboxd: fetchLetterboxdTitle
      }[type];
      
      if (fetchFunction) {
        await fetchFunction(url, setFieldValue);
      }
    } finally {
      setIsLoadingTitle(prev => ({ ...prev, [type]: false }));
    }
  };

  // Custom Trakt List URL
  if (values.type === 'trakt' && values.subtype === 'custom') {
    return (
      <div>
        <label htmlFor="traktCustomListUrl" className="block text-sm font-medium text-gray-300 mb-2">
          {intl.formatMessage(messages.customTraktListUrl)} <span className="text-red-500">*</span>
        </label>
        <div className="flex gap-2">
          <Field
            type="url"
            id="traktCustomListUrl"
            name="traktCustomListUrl"
            placeholder="https://trakt.tv/users/username/lists/listname"
            className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
          {fetchTraktTitle && (
            <button
              type="button"
              onClick={() => handleFetchTitle('trakt')}
              disabled={!values.traktCustomListUrl || isLoadingTitle.trakt}
              className="px-3 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            >
              {isLoadingTitle.trakt 
                ? intl.formatMessage(messages.fetching)
                : intl.formatMessage(messages.fetchTitle)
              }
            </button>
          )}
        </div>
        <ErrorMessage name="traktCustomListUrl" component="div" className="text-red-500 text-sm mt-1" />
        <p className="mt-1 text-xs text-gray-400">
          Example: https://trakt.tv/users/username/lists/listname
        </p>
      </div>
    );
  }

  // Custom TMDb Collection URL
  if (values.type === 'tmdb' && values.subtype === 'custom') {
    return (
      <div>
        <label htmlFor="tmdbCustomCollectionUrl" className="block text-sm font-medium text-gray-300 mb-2">
          {intl.formatMessage(messages.customTmdbCollectionUrl)} <span className="text-red-500">*</span>
        </label>
        <div className="flex gap-2">
          <Field
            type="url"
            id="tmdbCustomCollectionUrl"
            name="tmdbCustomCollectionUrl"
            placeholder="https://www.themoviedb.org/collection/12345"
            className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
          {fetchTmdbTitle && (
            <button
              type="button"
              onClick={() => handleFetchTitle('tmdb')}
              disabled={!values.tmdbCustomCollectionUrl || isLoadingTitle.tmdb}
              className="px-3 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            >
              {isLoadingTitle.tmdb 
                ? intl.formatMessage(messages.fetching)
                : intl.formatMessage(messages.fetchTitle)
              }
            </button>
          )}
        </div>
        <ErrorMessage name="tmdbCustomCollectionUrl" component="div" className="text-red-500 text-sm mt-1" />
        <p className="mt-1 text-xs text-gray-400">
          Example: https://www.themoviedb.org/collection/12345-collection-name
        </p>
      </div>
    );
  }

  // Custom IMDb List URL
  if (values.type === 'imdb' && values.subtype === 'custom') {
    return (
      <div>
        <label htmlFor="imdbCustomListUrl" className="block text-sm font-medium text-gray-300 mb-2">
          {intl.formatMessage(messages.customImdbListUrl)} <span className="text-red-500">*</span>
        </label>
        <div className="flex gap-2">
          <Field
            type="url"
            id="imdbCustomListUrl"
            name="imdbCustomListUrl"
            placeholder="https://www.imdb.com/list/ls123456789/"
            className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
          {fetchImdbTitle && (
            <button
              type="button"
              onClick={() => handleFetchTitle('imdb')}
              disabled={!values.imdbCustomListUrl || isLoadingTitle.imdb}
              className="px-3 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            >
              {isLoadingTitle.imdb 
                ? intl.formatMessage(messages.fetching)
                : intl.formatMessage(messages.fetchTitle)
              }
            </button>
          )}
        </div>
        <ErrorMessage name="imdbCustomListUrl" component="div" className="text-red-500 text-sm mt-1" />
        <p className="mt-1 text-xs text-gray-400">
          Example: https://www.imdb.com/list/ls123456789/ or https://www.imdb.com/user/ur12345678/lists/
        </p>
      </div>
    );
  }

  // Custom Letterboxd List URL
  if (values.type === 'letterboxd' && values.subtype === 'custom') {
    return (
      <div>
        <label htmlFor="letterboxdCustomListUrl" className="block text-sm font-medium text-gray-300 mb-2">
          {intl.formatMessage(messages.customLetterboxdListUrl)} <span className="text-red-500">*</span>
        </label>
        <div className="flex gap-2">
          <Field
            type="url"
            id="letterboxdCustomListUrl"
            name="letterboxdCustomListUrl"
            placeholder="https://letterboxd.com/username/list/listname/"
            className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
          {fetchLetterboxdTitle && (
            <button
              type="button"
              onClick={() => handleFetchTitle('letterboxd')}
              disabled={!values.letterboxdCustomListUrl || isLoadingTitle.letterboxd}
              className="px-3 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            >
              {isLoadingTitle.letterboxd 
                ? intl.formatMessage(messages.fetching)
                : intl.formatMessage(messages.fetchTitle)
              }
            </button>
          )}
        </div>
        <ErrorMessage name="letterboxdCustomListUrl" component="div" className="text-red-500 text-sm mt-1" />
        <p className="mt-1 text-xs text-gray-400">
          Example: https://letterboxd.com/username/list/listname/
        </p>
      </div>
    );
  }

  return null;
};

export default CustomUrlSection;