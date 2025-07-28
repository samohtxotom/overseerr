#!/usr/bin/env python3

"""
Script to reverse engineer Plex collection sort API calls.
This will help us see what the official PlexAPI library actually sends to Plex.
"""

import os
import logging
from plexapi.server import PlexServer
from plexapi.collection import Collection

# Enable debug logging to see HTTP requests
logging.basicConfig(level=logging.DEBUG)

# Plex connection settings from your network request
PLEX_URL = 'https://192-168-0-236.fab556644298455eb879c717b49c0072.plex.direct:32400'
PLEX_TOKEN = 'cp81Q3B3h4FEbRPHXueE'

def main():
    try:
        print("Connecting to Plex server...")
        plex = PlexServer(PLEX_URL, PLEX_TOKEN)
        
        print("Connected! Looking for collections...")
        
        # Find all collections
        collections = []
        for library in plex.library.sections():
            if library.type in ['movie', 'show']:
                print(f"Checking library: {library.title}")
                try:
                    lib_collections = library.collections()
                    collections.extend(lib_collections)
                    print(f"Found {len(lib_collections)} collections in {library.title}")
                except Exception as e:
                    print(f"Error getting collections from {library.title}: {e}")
        
        if not collections:
            print("No collections found!")
            return
            
        # Use the specific collection we know exists (rating key 29985)
        test_collection = None
        for collection in collections:
            if collection.ratingKey == '29985':
                test_collection = collection
                break
                
        if not test_collection:
            # Find an Overseerr collection to test with
            for collection in collections:
                if 'requests' in collection.title.lower() or 'overseerr' in str(collection.labels).lower():
                    test_collection = collection
                    break
                    
        if not test_collection:
            # Use the first collection we find
            test_collection = collections[0]
            
        print(f"\nTesting with collection: {test_collection.title}")
        print(f"Collection rating key: {test_collection.ratingKey}")
        print(f"Current labels: {getattr(test_collection, 'labels', 'No labels')}")
        
        # This is the key part - set sort to custom and watch the HTTP request
        print(f"\n=== SETTING SORT TO CUSTOM ===")
        print("Watch the debug logs above for the actual HTTP request...")
        
        test_collection.sortUpdate(sort="custom")
        
        print("Sort update completed!")
        print(f"Collection sort should now be: custom")
        
    except Exception as e:
        print(f"Error: {e}")
        print("Make sure to update PLEX_URL and PLEX_TOKEN in the script!")

if __name__ == "__main__":
    main()