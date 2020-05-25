#!/bin/sh

#osascript -e 'set the bounds of the first window of application "Firefox Developer Edition" to {0, 0, 1280, 800}'

# Reduce size for the artificial shadow added by the preview snapshots
#osascript -e 'set the bounds of the first window of application "Firefox Developer Edition" to {0, 0, 1168, 688}'

# HiDPI - based on new guidance from AMO, with subtractions to account for
# window shadow
osascript -e 'set the bounds of the first window of application "Firefox Developer Edition" to {0, 0, 1200-112, 900-112}'
