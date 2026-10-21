#!/bin/bash
# Sets the Twilio env vars for the Money Tracker MMS invoices on the brysonhunter-site Vercel project, then redeploys.
# Use the SAME Twilio account and number as the MHG Command app. Values are typed at hidden prompts, never in chat.
set -e
cd "$(dirname "$0")/.."
read -r -p "Twilio Account SID (starts with AC): " SID
read -r -s -p "Twilio Auth Token (hidden): " TOK; echo
read -r -p "From number [+18014572469]: " FROM
FROM=${FROM:-+18014572469}
[ -n "$SID" ] && [ -n "$TOK" ] || { echo "empty, aborting"; exit 1; }
for kv in "TWILIO_ACCOUNT_SID:$SID" "TWILIO_AUTH_TOKEN:$TOK" "TWILIO_FROM:$FROM"; do
  k=${kv%%:*}; v=${kv#*:}
  vercel env rm "$k" production --yes >/dev/null 2>&1 || true
  printf '%s' "$v" | vercel env add "$k" production >/dev/null
  echo "set $k"
done
unset SID TOK
vercel --prod --yes
