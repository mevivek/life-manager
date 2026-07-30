#!/usr/bin/env bash
#
# Binds a credential group to the deployed API, one group at a time.
#
#     ./scripts/provision.sh r2       # the four R2_* values
#     ./scripts/provision.sh vapid    # the three VAPID_* values
#     ./scripts/provision.sh neon     # rotate DATABASE_URL + DATABASE_URL_UNPOOLED (debt D18)
#     ./scripts/provision.sh cron     # CRON_SECRET + the Cloud Scheduler job (ADR-0028)
#     ./scripts/provision.sh status   # what is bound right now, names only
#
# ── Why a script rather than a list of commands in the README ──
#
# Three of the steps are easy to get subtly wrong in ways that fail late:
#
#  1. **Each group is all-or-none.** `apps/api/src/env.ts` rejects a partially-set group at BOOT, so
#     setting two of the four R2 values produces a revision that never becomes healthy. Every group
#     here is therefore bound in a SINGLE `gcloud run services update` call.
#  2. **`--set-secrets` / `--set-env-vars` REPLACE the whole list.** Using them would silently unbind
#     DATABASE_URL, DATABASE_URL_UNPOOLED, BETTER_AUTH_SECRET and GOOGLE_CLIENT_SECRET. This script
#     only ever uses the `--update-` forms.
#  3. **The runtime service account has `secretAccessor` per-secret, not project-wide** (README
#     § Secrets, deliberately — it is not the broadly-privileged default compute account). A new
#     secret is unreadable until it is granted explicitly, and the failure looks like a boot crash
#     rather than a permission error.
#
# ── How secrets are handled ──
#
# Values are read from an interactive prompt with echo OFF, and piped to `gcloud` via `--data-file=-`.
# They are never passed as command-line arguments and never written to a file, so they do not land in
# shell history, in `ps` output, or in this repo (CLAUDE.md invariant 11, security-model.md §6).
#
# Nothing here prints a secret value. `status` prints names and bindings only.

set -euo pipefail

PROJECT="${PROJECT:-life-manager-01}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-life-manager-api}"
RUNTIME_SA="${RUNTIME_SA:-life-manager-api@life-manager-01.iam.gserviceaccount.com}"
SCHEDULER_JOB="${SCHEDULER_JOB:-life-manager-daily-scan}"
API_ORIGIN="${API_ORIGIN:-https://api.mevivek.dev}"

die() {
  printf '\nerror: %s\n' "$1" >&2
  exit 1
}

note() { printf '  %s\n' "$1"; }

# Checked per-action rather than at the top of the file, so `usage` and `--help` still work on a
# machine without gcloud — including the container this was written in.
require_gcloud() {
  command -v gcloud >/dev/null 2>&1 ||
    die "gcloud is not installed. This script must run on your machine, not in an agent container."
}

# ── helpers ──────────────────────────────────────────────────────────────────────────────────────

# Prompts for a value with echo off. Rejects empty input rather than storing a blank secret, which
# would satisfy env.ts's `.min(1)` check nowhere and fail at boot.
read_secret() {
  local prompt="$1" value=""
  while [ -z "$value" ]; do
    printf '  %s: ' "$prompt" >&2
    read -rs value
    printf '\n' >&2
    [ -z "$value" ] && printf '  (empty — try again)\n' >&2
  done
  printf '%s' "$value"
}

# Prompts for a NON-secret value, echoed so it can be checked for typos.
read_plain() {
  local prompt="$1" value=""
  while [ -z "$value" ]; do
    printf '  %s: ' "$prompt" >&2
    read -r value
    [ -z "$value" ] && printf '  (empty — try again)\n' >&2
  done
  printf '%s' "$value"
}

# Creates the secret if it does not exist, otherwise adds a new version. Idempotent on purpose: a
# re-run after a typo must not fail, and rotation is the same operation as creation.
store_secret() {
  local name="$1" value="$2"
  if gcloud secrets describe "$name" --project="$PROJECT" >/dev/null 2>&1; then
    printf %s "$value" | gcloud secrets versions add "$name" --data-file=- --project="$PROJECT" >/dev/null
    note "$name — new version added"
  else
    printf %s "$value" | gcloud secrets create "$name" --data-file=- --project="$PROJECT" >/dev/null
    note "$name — created"
  fi

  # Idempotent: re-granting an existing binding is a no-op.
  gcloud secrets add-iam-policy-binding "$name" \
    --member="serviceAccount:${RUNTIME_SA}" \
    --role=roles/secretmanager.secretAccessor \
    --project="$PROJECT" >/dev/null
  note "$name — runtime account granted secretAccessor"
}

confirm_target() {
  printf '\nTarget\n'
  note "project  $PROJECT"
  note "region   $REGION"
  note "service  $SERVICE"
  printf '\nThis modifies a PRODUCTION service. Type the project id to continue: '
  local typed
  read -r typed
  [ "$typed" = "$PROJECT" ] || die "aborted (typed '$typed')"
}

# ── groups ───────────────────────────────────────────────────────────────────────────────────────

provision_r2() {
  require_gcloud
  cat <<'EOF'

R2 — file storage (ADR-0008)
────────────────────────────
Create the bucket and an "Object Read & Write" API token scoped to it, in the Cloudflare dashboard.

  ⚠ Also set the bucket's CORS policy, or every browser upload fails while the API looks healthy.
    The browser PUTs straight to R2, so the bucket must allow your app's origin. See README
    § Running the file path locally / § Provisioning R2 for the exact JSON.

EOF
  local account_id bucket access_key secret_key
  account_id=$(read_plain 'R2 account id')
  bucket=$(read_plain 'R2 bucket name')
  access_key=$(read_secret 'R2 access key id')
  secret_key=$(read_secret 'R2 secret access key')

  confirm_target

  printf '\nStoring credentials\n'
  store_secret R2_ACCESS_KEY_ID "$access_key"
  store_secret R2_SECRET_ACCESS_KEY "$secret_key"

  # ONE call: env.ts requires all four together, so a two-step bind would leave a broken revision.
  printf '\nBinding to %s\n' "$SERVICE"
  gcloud run services update "$SERVICE" \
    --region="$REGION" --project="$PROJECT" \
    --update-secrets=R2_ACCESS_KEY_ID=R2_ACCESS_KEY_ID:latest,R2_SECRET_ACCESS_KEY=R2_SECRET_ACCESS_KEY:latest \
    --update-env-vars="R2_ACCOUNT_ID=${account_id},R2_BUCKET=${bucket}" \
    --quiet
  note 'done'

  printf '\nVerify: file endpoints should stop answering 503.\n'
  note "node scripts/verify-deployment.mjs"
}

provision_vapid() {
  require_gcloud
  cat <<'EOF'

VAPID — Web Push for reminders (RFC 8292)
─────────────────────────────────────────
Generate the pair FIRST, in another terminal, and keep it out of any transcript:

    node scripts/generate-vapid-keys.mjs

Use that script and not `web-push --generate-vapid-keys`: webpush-webcrypto encodes its private key
in its own format, and a pair from elsewhere will not load.

EOF
  local public_key private_key subject
  # The public key is public by design — it is served to browsers by GET /api/v1/push/public-key —
  # so it is echoed, which also lets you eyeball it against the generator's output.
  public_key=$(read_plain 'VAPID public key')
  subject=$(read_plain 'VAPID subject (mailto:you@example.com)')
  private_key=$(read_secret 'VAPID private key')

  confirm_target

  printf '\nStoring credentials\n'
  store_secret VAPID_PRIVATE_KEY "$private_key"

  printf '\nBinding to %s\n' "$SERVICE"
  gcloud run services update "$SERVICE" \
    --region="$REGION" --project="$PROJECT" \
    --update-secrets=VAPID_PRIVATE_KEY=VAPID_PRIVATE_KEY:latest \
    --update-env-vars="VAPID_PUBLIC_KEY=${public_key},VAPID_SUBJECT=${subject}" \
    --quiet
  note 'done'

  printf '\nVerify: the endpoint should return a key rather than null.\n'
  note "curl -s https://api.mevivek.dev/api/v1/push/public-key"
}

provision_neon() {
  require_gcloud
  cat <<'EOF'

Neon credential rotation (debt D18)
───────────────────────────────────
The current credential was exposed in a chat transcript and is unrotated. Neon's free tier has no IP
allowlist, so the string alone is full read/write/drop. Its trigger is "before the first real
document is stored" — so do this BEFORE putting real documents in, not after.

Reset the role password in the Neon console first, then paste both connection strings here.
Remember to update apps/api/.env too; verify-deployment.mjs reads DATABASE_URL_UNPOOLED from it.

EOF
  local pooled unpooled
  pooled=$(read_secret 'new DATABASE_URL (pooled)')
  unpooled=$(read_secret 'new DATABASE_URL_UNPOOLED (direct)')

  confirm_target

  printf '\nStoring credentials\n'
  store_secret DATABASE_URL "$pooled"
  store_secret DATABASE_URL_UNPOOLED "$unpooled"

  printf '\nBinding to %s\n' "$SERVICE"
  gcloud run services update "$SERVICE" \
    --region="$REGION" --project="$PROJECT" \
    --update-secrets=DATABASE_URL=DATABASE_URL:latest,DATABASE_URL_UNPOOLED=DATABASE_URL_UNPOOLED:latest \
    --quiet
  note 'done'

  printf '\nVerify: the API migrates on boot (ADR-0023), so a healthy revision means it connected.\n'
  note "curl -s https://api.mevivek.dev/api/v1/health"
  printf '\nThen mark D18 closed in docs/product/review.md and security-model.md §7 — BOTH lists.\n'
}

# The one group that provisions something OUTSIDE Cloud Run as well: the Cloud Scheduler job that
# calls the endpoint. ADR-0028.
provision_cron() {
  require_gcloud
  cat <<'EOF'

CRON_SECRET + Cloud Scheduler — the daily reminder scan (ADR-0028)
──────────────────────────────────────────────────────────────────
This is the last thing standing between M1 and its "done when": a notification that actually arrives.

Generate a secret first, in another terminal, and keep it out of any transcript:

    openssl rand -base64 32

The SAME value goes in two places — Secret Manager (so the API knows it) and the Scheduler job's
header (so the caller sends it). This script does both, so you paste it once.

  ⚠ Until CRON_SECRET is bound, the endpoint answers 503, not 200. That is deliberate: an
    unconfigured trigger is CLOSED. A 503 here means "not provisioned", never "wrong key".

EOF
  local secret
  secret=$(read_secret 'CRON_SECRET (32+ chars)')

  if [ "${#secret}" -lt 32 ]; then
    die "that is ${#secret} characters; env.ts requires at least 32 and the API would fail to boot"
  fi

  confirm_target

  printf '\nStoring credential\n'
  store_secret CRON_SECRET "$secret"

  printf '\nBinding to %s\n' "$SERVICE"
  gcloud run services update "$SERVICE" \
    --region="$REGION" --project="$PROJECT" \
    --update-secrets=CRON_SECRET=CRON_SECRET:latest \
    --quiet
  note 'done'

  # Enable the API before creating the job: otherwise the create fails with a permission-shaped
  # error that sends you looking at IAM instead of at service enablement.
  printf '\nEnabling cloudscheduler.googleapis.com\n'
  gcloud services enable cloudscheduler.googleapis.com --project="$PROJECT" --quiet
  note 'done'

  # 08:00 UTC, matching the time domains/documents.md §6 specifies for the scan.
  #
  # --headers passes the secret to `gcloud` as an ARGUMENT, which is the one place in this script a
  # value reaches a command line. Unavoidable: Cloud Scheduler has no file-based header input. It is
  # visible in this shell's `ps` for the duration of the call, so run this on your own machine and not
  # on a shared host. The value is not written to disk and not echoed.
  printf '\nCreating the Scheduler job\n'
  if gcloud scheduler jobs describe "$SCHEDULER_JOB" --location="$REGION" --project="$PROJECT" >/dev/null 2>&1; then
    note 'job exists — updating it'
    gcloud scheduler jobs update http "$SCHEDULER_JOB" \
      --location="$REGION" --project="$PROJECT" \
      --schedule='0 8 * * *' --time-zone=Etc/UTC \
      --uri="${API_ORIGIN}/api/v1/maintenance:run-daily" \
      --http-method=POST \
      --headers="X-Cron-Key=${secret}" \
      --attempt-deadline=180s \
      --quiet
  else
    gcloud scheduler jobs create http "$SCHEDULER_JOB" \
      --location="$REGION" --project="$PROJECT" \
      --schedule='0 8 * * *' --time-zone=Etc/UTC \
      --uri="${API_ORIGIN}/api/v1/maintenance:run-daily" \
      --http-method=POST \
      --headers="X-Cron-Key=${secret}" \
      --attempt-deadline=180s \
      --description='Daily reminder scan and sweep (ADR-0028)' \
      --quiet
  fi
  note 'done'

  cat <<EOF

Verify — do not wait until 08:00 UTC to find out:

  1. Run it now, and read the counts rather than just the status code:
       gcloud scheduler jobs run ${SCHEDULER_JOB} --location=${REGION} --project=${PROJECT}
       gcloud scheduler jobs describe ${SCHEDULER_JOB} --location=${REGION} --project=${PROJECT} \\
         --format='value(status,lastAttemptTime)'

  2. Read what the API reported. "found 0" means nothing was due, which is NOT the same as working:
       gcloud run services logs read ${SERVICE} --region=${REGION} --project=${PROJECT} --limit=20

  3. For a notification you can actually see, you need a reminder inside its lead window AND a push
     subscription on your phone (turn reminders on from the You screen). With no subscription the run
     reports 'undelivered', which is honest, not broken.

EOF
}

# Read-only checks, run BEFORE any credential is typed.
#
# Every failure below otherwise shows up halfway through a provisioning run — after the secret has
# been pasted, and usually wearing a misleading error. A wrong active project is the worst of them:
# `secrets create` would happily succeed somewhere else entirely.
preflight() {
  require_gcloud
  local failures=0
  local check_ok='  ok   '
  local check_no='  FAIL '

  printf '\nPreflight — nothing is written, nothing is prompted for\n\n'

  local account
  account=$(gcloud config get-value account 2>/dev/null)
  if [ -n "$account" ] && [ "$account" != '(unset)' ]; then
    printf '%s authenticated as %s\n' "$check_ok" "$account"
  else
    printf '%s not authenticated — run: gcloud auth login\n' "$check_no"
    failures=$((failures + 1))
  fi

  if gcloud projects describe "$PROJECT" >/dev/null 2>&1; then
    printf '%s project %s reachable\n' "$check_ok" "$PROJECT"
  else
    printf '%s cannot reach project %s\n' "$check_no" "$PROJECT"
    failures=$((failures + 1))
  fi

  if gcloud run services describe "$SERVICE" --region="$REGION" --project="$PROJECT" >/dev/null 2>&1; then
    printf '%s Cloud Run service %s exists in %s\n' "$check_ok" "$SERVICE" "$REGION"
  else
    printf '%s no Cloud Run service %s in %s\n' "$check_no" "$SERVICE" "$REGION"
    failures=$((failures + 1))
  fi

  if gcloud iam service-accounts describe "$RUNTIME_SA" --project="$PROJECT" >/dev/null 2>&1; then
    printf '%s runtime account exists\n' "$check_ok"
  else
    printf '%s runtime account %s not found\n' "$check_no" "$RUNTIME_SA"
    failures=$((failures + 1))
  fi

  # A read test for Secret Manager access. Not proof of write permission, but it catches the common
  # case of the API being disabled or the caller having no role on it at all.
  if gcloud secrets list --project="$PROJECT" --limit=1 >/dev/null 2>&1; then
    printf '%s Secret Manager readable\n' "$check_ok"
  else
    printf '%s cannot list secrets — API disabled, or no secretmanager role\n' "$check_no"
    failures=$((failures + 1))
  fi

  printf '\nCurrently bound (names only)\n'
  local bound
  bound=$(gcloud run services describe "$SERVICE" --region="$REGION" --project="$PROJECT" \
    --format='value(spec.template.spec.containers[0].env[].name)' 2>/dev/null | tr ';' '\n')

  # Reports each group as complete / partial / absent, because "partial" is the state that makes the
  # service fail to boot and it is invisible from a list of names alone.
  group_state 'R2' "$bound" R2_ACCOUNT_ID R2_BUCKET R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY
  group_state 'VAPID' "$bound" VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY VAPID_SUBJECT
  group_state 'CRON' "$bound" CRON_SECRET

  if [ "$failures" -gt 0 ]; then
    printf '\n%d check(s) failed. Fix those before provisioning anything.\n' "$failures"
    exit 1
  fi
  printf '\nAll clear. Next: ./scripts/provision.sh r2\n'
}

# Prints whether a named credential group is fully bound, partly bound, or absent.
group_state() {
  local label="$1" bound="$2"
  shift 2
  local present=0 total=0 name
  for name in "$@"; do
    total=$((total + 1))
    printf '%s\n' "$bound" | grep -qx "$name" && present=$((present + 1))
  done

  if [ "$present" -eq 0 ]; then
    printf '  %-6s not set — the feature is off, which is a valid state\n' "$label"
  elif [ "$present" -eq "$total" ]; then
    printf '  %-6s all %d set\n' "$label" "$total"
  else
    printf '  %-6s ** PARTIAL (%d of %d) — the API will not boot; env.ts rejects this **\n' \
      "$label" "$present" "$total"
  fi
}

show_status() {
  require_gcloud
  printf '\nSecrets in %s\n' "$PROJECT"
  gcloud secrets list --project="$PROJECT" --format='value(name)' 2>/dev/null | sed 's/^/  /' || note '(none readable)'

  printf '\nBound to %s (names only, no values)\n' "$SERVICE"
  gcloud run services describe "$SERVICE" --region="$REGION" --project="$PROJECT" \
    --format='value(spec.template.spec.containers[0].env[].name)' 2>/dev/null | tr ';' '\n' | sed 's/^/  /'
}

case "${1:-}" in
  preflight) preflight ;;
  r2) provision_r2 ;;
  vapid) provision_vapid ;;
  neon) provision_neon ;;
  cron) provision_cron ;;
  status) show_status ;;
  *)
    cat <<'EOF'
usage: ./scripts/provision.sh <preflight|r2|vapid|neon|cron|status>

  preflight  check auth, project, service and permissions — writes nothing. START HERE.
  r2      bind the four R2_* values      (file storage; also set bucket CORS — see README)
  vapid   bind the three VAPID_* values  (run scripts/generate-vapid-keys.mjs first)
  neon    rotate the database credential (debt D18 — before the first real document)
  cron    bind CRON_SECRET and create the Cloud Scheduler job (ADR-0028 — makes reminders fire)
  status  show what is bound, names only

Override the target with PROJECT=, REGION=, SERVICE=, RUNTIME_SA= if it ever moves.
EOF
    exit 1
    ;;
esac
