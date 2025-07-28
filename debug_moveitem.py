#!/usr/bin/env python3

from plexapi.server import PlexServer
import logging

# Enable debug logging to see HTTP requests
logging.basicConfig(level=logging.DEBUG)

# Connect to Plex
plex = PlexServer('https://192-168-0-236.fab556644298455eb879c717b49c0072.plex.direct:32400', 'cp81Q3B3h4FEbRPHXueE')

# Find a collection with multiple items
collection = None
for lib in plex.library.sections():
    if lib.type in ['movie', 'show']:
        for coll in lib.collections():
            if 'requests' in coll.title.lower() and len(coll.items()) > 2:
                collection = coll
                break
        if collection:
            break

if collection:
    print(f'Using collection: {collection.title} (ratingKey: {collection.ratingKey})')
    items = collection.items()
    print(f'Items in collection: {len(items)}')
    
    if len(items) >= 2:
        print(f'\n=== MOVING ITEM TO TEST moveItem API ===')
        print(f'Moving "{items[1].title}" to the beginning (after first item)')
        
        # This will show us the HTTP request for moveItem
        collection.moveItem(items[1], after=items[0])
        
        print('Move completed!')
    else:
        print('Collection needs at least 2 items to test moveItem')
else:
    print('No suitable collection found!')