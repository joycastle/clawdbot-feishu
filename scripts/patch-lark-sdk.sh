#!/bin/bash
# Patch @larksuiteoapi/node-sdk to support card action callbacks via WebSocket.
#
# The SDK's WSClient.handleEventData only processes type="event" frames,
# but card action callbacks arrive as type="card" frames. This patch
# adds "card" to the accepted types.
#
# Run after npm install: npm run postinstall

SDK_DIR="node_modules/@larksuiteoapi/node-sdk"

for variant in es lib; do
  FILE="$SDK_DIR/$variant/index.js"
  if [ -f "$FILE" ]; then
    # Patch: accept card type in handleEventData
    if grep -q 'type !== MessageType.event)' "$FILE" && ! grep -q 'MessageType.card' "$FILE"; then
      sed -i 's/type !== MessageType\.event)/type !== MessageType.event \&\& type !== MessageType.card)/' "$FILE"
      echo "Patched $FILE: added MessageType.card support"
    else
      echo "Skipped $FILE: already patched or pattern not found"
    fi
  fi
done
