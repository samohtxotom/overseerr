#!/usr/bin/env python3

from plexapi.server import PlexServer

# Connect to Plex
plex = PlexServer('https://192-168-0-236.fab556644298455eb879c717b49c0072.plex.direct:32400', 'cp81Q3B3h4FEbRPHXueE')

# Find any Overseerr collection
collection = None
print('Looking for collections...')

for lib in plex.library.sections():
    if lib.type in ['movie', 'show']:
        print(f'Checking library: {lib.title}')
        for coll in lib.collections():
            print(f'  Found collection: {coll.title} (ratingKey: {coll.ratingKey})')
            # Look for any collection with "requests" in the name or Overseerr labels
            if 'requests' in coll.title.lower() or hasattr(coll, 'labels'):
                collection = coll
                break
        if collection:
            break

if collection:
    print(f'\nUsing collection: {collection.title} (ratingKey: {collection.ratingKey})')
    print('Items in collection (current order):')
    items = collection.items()
    for i, item in enumerate(items):
        print(f'{i+1}. {item.title} (ratingKey: {item.ratingKey})')
    
    print(f'\nCollection has {len(items)} items total')
else:
    print('No suitable collection found!')