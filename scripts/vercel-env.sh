#!/usr/bin/env bash
#
# Push the local .env into the linked Vercel project.
#
# Ten variables across two environments is sixty-odd fields to retype in a
# dashboard, and a mistyped connection string fails at runtime rather than at
# paste time. This reads the values that already work locally and sends them
# through the CLI instead.
#
#   vercel login && vercel link      # once, interactively
#   bash scripts/vercel-env.sh       # then this
#
# Values are never printed. The script reports names and target environments
# only, so a shared terminal or a pasted transcript cannot leak a secret.

set -euo pipefail

ENV_FILE="${1:-.env}"

if [ ! -f "$ENV_FILE" ]; then
  echo "No $ENV_FILE here. Run this from the project root." >&2
  exit 1
fi

if [ ! -f ".vercel/project.json" ]; then
  echo "This project is not linked yet. Run 'vercel link' first." >&2
  exit 1
fi

# APP_BASE_URL is deliberately absent from this list and set separately, for
# production only. A preview deployment with APP_BASE_URL pointing at
# production would email assessment links that leave the preview entirely —
# the clinician tests on dev and the patient lands on the live site. Unset,
# lib/actions/assessments.ts falls back to VERCEL_URL, which is the deployment
# actually being previewed.
#
# SEED_CLINICIAN_* are also absent: the seed is run from a developer machine
# against DATABASE_URL, never from a build, so Vercel has no use for them and
# every secret it does not hold is one that cannot leak from it.
SHARED_VARS=(
  DATABASE_URL
  DIRECT_URL
  AUTH_SECRET
  FHIR_BASE_URL
  FHIR_CANDIDATE_ID
  FHIR_API_KEY
  EMAIL_PROVIDER
  EMAIL_API_KEY
  EMAIL_FROM
)

# Reads one value from the env file without sourcing it, so a stray command
# substitution in a quoted value cannot execute.
read_value() {
  local key="$1"
  local line
  line=$(grep -E "^[[:space:]]*${key}=" "$ENV_FILE" | tail -1 || true)
  [ -z "$line" ] && return 1
  local value="${line#*=}"
  value="${value%$'\r'}"                       # CRLF, on Windows checkouts
  value="${value%\"}"; value="${value#\"}"     # surrounding double quotes
  value="${value%\'}"; value="${value#\'}"     # or single
  printf '%s' "$value"
}

push() {
  local key="$1" target="$2" value
  if ! value=$(read_value "$key"); then
    printf '  skip   %-20s not set in %s\n' "$key" "$ENV_FILE"
    return
  fi
  if [ -z "$value" ]; then
    printf '  skip   %-20s empty\n' "$key"
    return
  fi

  # Remove first so a re-run updates rather than erroring on an existing key.
  vercel env rm "$key" "$target" --yes >/dev/null 2>&1 || true
  printf '%s' "$value" | vercel env add "$key" "$target" >/dev/null 2>&1
  printf '  ok     %-20s -> %s\n' "$key" "$target"
}

echo "Pushing ${#SHARED_VARS[@]} variables to production and preview."
echo "(values are never printed)"
echo

for target in production preview; do
  echo "$target:"
  for key in "${SHARED_VARS[@]}"; do
    push "$key" "$target"
  done
  echo
done

cat <<'NEXT'
Done.

One variable is deliberately not set above:

  APP_BASE_URL   production only, and only once you know the URL:

    vercel env add APP_BASE_URL production      # https://<project>.vercel.app

  Leave it unset for preview so each preview emails links to itself.

Then redeploy so the new values are picked up — environment variables are read
at build time, so an existing deployment will not see them:

  vercel --prod
NEXT
