<#
.SYNOPSIS
  Binds a credential group to the deployed API. PowerShell port of provision.sh.

.DESCRIPTION
  .\scripts\provision.ps1 preflight   # check auth, project, service — writes nothing. START HERE.
  .\scripts\provision.ps1 r2          # the four R2_* values
  .\scripts\provision.ps1 vapid       # the three VAPID_* values
  .\scripts\provision.ps1 neon        # rotate DATABASE_URL + DATABASE_URL_UNPOOLED (debt D18)
  .\scripts\provision.ps1 status      # what is bound right now, names only

  Same behaviour and the same reasoning as provision.sh — see that file's header for why each
  credential group is bound in ONE update call, why only the `--update-` forms are used, and why
  the runtime account needs a per-secret grant. This exists because the maintainer's machine is
  Windows and PowerShell cannot execute a .sh.

  ── Two Windows-specific hazards this handles ──

  1. **PowerShell writes your command history to disk.** `ConsoleHost_history.txt` records every
     line you type, forever, in plaintext. So a secret pasted into an inline `gcloud` command lands
     in a file on disk. Here, secrets are read with `Read-Host -AsSecureString`, which never enters
     history and never echoes.

  2. **Piping to a native command appends a newline.** `$value | gcloud ... --data-file=-` would
     store the secret WITH a trailing newline, and a credential with a stray `\n` fails
     authentication in ways that look like a wrong password. `Write-SecretToStdin` below writes the
     exact bytes to the process's stdin instead, so nothing is added.
#>

[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateSet('preflight', 'r2', 'vapid', 'neon', 'status')]
  [string]$Command,

  [string]$Project = 'life-manager-01',
  [string]$Region = 'us-central1',
  [string]$Service = 'life-manager-api',
  [string]$RuntimeSA = 'life-manager-api@life-manager-01.iam.gserviceaccount.com'
)

$ErrorActionPreference = 'Stop'

# gcloud on Windows is a .cmd shim; calling bare `gcloud` from a script may not resolve.
$script:GcloudExe = $null

function Resolve-Gcloud {
  if ($script:GcloudExe) { return $script:GcloudExe }
  foreach ($candidate in @('gcloud.cmd', 'gcloud')) {
    $found = Get-Command $candidate -ErrorAction SilentlyContinue
    if ($found) { $script:GcloudExe = $found.Source; return $script:GcloudExe }
  }
  throw "gcloud is not on PATH. Install the Google Cloud CLI, then run: gcloud auth login"
}

<#
  Runs gcloud and returns ONLY a success boolean.

  Command output is sent to the host rather than down the pipeline, deliberately. A function that
  emitted both the output lines and the boolean would make `$ok = Invoke-Gcloud ...` an array, and
  `if (-not $ok)` on an array does not mean what it looks like — so a failed bind would read as a
  success.
#>
function Invoke-Gcloud {
  param([string[]]$GcArgs, [switch]$Quiet)
  $exe = Resolve-Gcloud
  if ($Quiet) { & $exe @GcArgs 2>&1 | Out-Null }
  else { & $exe @GcArgs 2>&1 | ForEach-Object { Write-Host $_ } }
  return $LASTEXITCODE -eq 0
}

function Get-GcloudValue {
  param([string[]]$GcArgs)
  $exe = Resolve-Gcloud
  $out = & $exe @GcArgs 2>$null
  if ($LASTEXITCODE -ne 0) { return $null }
  return ($out | Out-String).Trim()
}

<#
  Writes a secret to gcloud's stdin as exact bytes.

  This is the whole reason the script does not use a pipeline: PowerShell's pipeline to a native
  command re-encodes the text and appends a newline, so the stored secret would differ from what you
  typed. An R2 secret key with a trailing newline authenticates against nothing and the error says
  only "SignatureDoesNotMatch".
#>
function Write-SecretToStdin {
  param([string[]]$GcArgs, [string]$Value)

  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = Resolve-Gcloud

  # `.Arguments` (one string), NOT `.ArgumentList`. The latter does not exist in Windows PowerShell
  # 5.1's .NET Framework — it arrived with .NET Core — and this script has to run on the stock
  # PowerShell that ships with Windows. Quoting only where needed keeps the command line readable in
  # any error message.
  $quoted = $GcArgs | ForEach-Object {
    if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ }
  }
  $psi.Arguments = ($quoted -join ' ')

  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardError = $true
  $psi.UseShellExecute = $false

  $proc = [System.Diagnostics.Process]::Start($psi)
  $proc.StandardInput.Write($Value)   # NoNewline by construction
  $proc.StandardInput.Close()
  $stderr = $proc.StandardError.ReadToEnd()
  $proc.WaitForExit()

  if ($proc.ExitCode -ne 0) { throw "gcloud failed: $stderr" }
}

# Reads a secret without echoing it and without it entering PowerShell history.
function Read-Secret {
  param([string]$Prompt)
  while ($true) {
    $secure = Read-Host -Prompt "  $Prompt" -AsSecureString
    $plain = [System.Net.NetworkCredential]::new('', $secure).Password
    if ($plain) { return $plain }
    Write-Host '  (empty - try again)' -ForegroundColor Yellow
  }
}

# Reads a NON-secret value, echoed so it can be checked for typos.
function Read-Plain {
  param([string]$Prompt)
  while ($true) {
    $value = Read-Host -Prompt "  $Prompt"
    if ($value) { return $value.Trim() }
    Write-Host '  (empty - try again)' -ForegroundColor Yellow
  }
}

# Creates the secret, or adds a version if it exists. Idempotent: a re-run after a typo must work,
# and rotation is the same operation as creation.
function Set-Secret {
  param([string]$Name, [string]$Value)

  $exists = Invoke-Gcloud -Quiet -GcArgs @('secrets', 'describe', $Name, "--project=$Project")
  if ($exists) {
    Write-SecretToStdin -Value $Value -GcArgs @('secrets', 'versions', 'add', $Name, '--data-file=-', "--project=$Project")
    Write-Host "  $Name - new version added"
  }
  else {
    Write-SecretToStdin -Value $Value -GcArgs @('secrets', 'create', $Name, '--data-file=-', "--project=$Project")
    Write-Host "  $Name - created"
  }

  # The runtime account holds secretAccessor per-secret and has no project-level roles, so a new
  # secret is unreadable until granted. That failure presents as a boot crash, not a permission error.
  Invoke-Gcloud -Quiet -GcArgs @(
    'secrets', 'add-iam-policy-binding', $Name,
    "--member=serviceAccount:$RuntimeSA",
    '--role=roles/secretmanager.secretAccessor',
    "--project=$Project"
  ) | Out-Null
  Write-Host "  $Name - runtime account granted secretAccessor"
}

function Confirm-Target {
  Write-Host ''
  Write-Host 'Target'
  Write-Host "  project  $Project"
  Write-Host "  region   $Region"
  Write-Host "  service  $Service"
  Write-Host ''
  $typed = Read-Host -Prompt "This modifies a PRODUCTION service. Type the project id to continue"
  if ($typed -ne $Project) { throw "aborted (typed '$typed')" }
}

function Get-BoundEnvNames {
  $raw = Get-GcloudValue -GcArgs @(
    'run', 'services', 'describe', $Service, "--region=$Region", "--project=$Project",
    '--format=value(spec.template.spec.containers[0].env[].name)'
  )
  if (-not $raw) { return @() }
  return $raw -split '[;\s]+' | Where-Object { $_ }
}

# Reports a credential group as complete / partial / absent. "Partial" is the state that stops the
# API booting (env.ts rejects it) and it is invisible from a plain list of names.
function Show-GroupState {
  param([string]$Label, [string[]]$Bound, [string[]]$Names)
  $present = @($Names | Where-Object { $Bound -contains $_ }).Count
  if ($present -eq 0) {
    Write-Host ("  {0,-6} not set - the feature is off, which is a valid state" -f $Label)
  }
  elseif ($present -eq $Names.Count) {
    Write-Host ("  {0,-6} all {1} set" -f $Label, $Names.Count) -ForegroundColor Green
  }
  else {
    Write-Host ("  {0,-6} ** PARTIAL ({1} of {2}) - the API will not boot; env.ts rejects this **" -f $Label, $present, $Names.Count) -ForegroundColor Red
  }
}

function Invoke-Preflight {
  Write-Host ''
  Write-Host 'Preflight - nothing is written, nothing is prompted for'
  Write-Host ''
  $failures = 0

  $account = Get-GcloudValue -GcArgs @('config', 'get-value', 'account')
  if ($account -and $account -ne '(unset)') { Write-Host "  ok    authenticated as $account" -ForegroundColor Green }
  else { Write-Host '  FAIL  not authenticated - run: gcloud auth login' -ForegroundColor Red; $failures++ }

  if (Invoke-Gcloud -Quiet -GcArgs @('projects', 'describe', $Project)) {
    Write-Host "  ok    project $Project reachable" -ForegroundColor Green
  }
  else { Write-Host "  FAIL  cannot reach project $Project" -ForegroundColor Red; $failures++ }

  if (Invoke-Gcloud -Quiet -GcArgs @('run', 'services', 'describe', $Service, "--region=$Region", "--project=$Project")) {
    Write-Host "  ok    Cloud Run service $Service exists in $Region" -ForegroundColor Green
  }
  else { Write-Host "  FAIL  no Cloud Run service $Service in $Region" -ForegroundColor Red; $failures++ }

  if (Invoke-Gcloud -Quiet -GcArgs @('iam', 'service-accounts', 'describe', $RuntimeSA, "--project=$Project")) {
    Write-Host '  ok    runtime account exists' -ForegroundColor Green
  }
  else { Write-Host "  FAIL  runtime account $RuntimeSA not found" -ForegroundColor Red; $failures++ }

  if (Invoke-Gcloud -Quiet -GcArgs @('secrets', 'list', "--project=$Project", '--limit=1')) {
    Write-Host '  ok    Secret Manager readable' -ForegroundColor Green
  }
  else { Write-Host '  FAIL  cannot list secrets - API disabled, or no secretmanager role' -ForegroundColor Red; $failures++ }

  Write-Host ''
  Write-Host 'Currently bound (names only)'
  $bound = Get-BoundEnvNames
  Show-GroupState -Label 'R2' -Bound $bound -Names @('R2_ACCOUNT_ID', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY')
  Show-GroupState -Label 'VAPID' -Bound $bound -Names @('VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT')

  if ($failures -gt 0) {
    Write-Host ''
    Write-Host "$failures check(s) failed. Fix those before provisioning anything." -ForegroundColor Red
    exit 1
  }
  Write-Host ''
  Write-Host 'All clear. Next: .\scripts\provision.ps1 r2' -ForegroundColor Green
}

function Invoke-R2 {
  Write-Host @'

R2 - file storage (ADR-0008)
----------------------------
Create the bucket and an "Object Read & Write" API token scoped to it, in the Cloudflare dashboard.

  ! Also set the bucket's CORS policy, or every browser upload fails while the API looks healthy.
    The browser PUTs straight to R2. See README section "Provisioning R2" for the exact JSON.

'@
  $accountId = Read-Plain 'R2 account id'
  $bucket = Read-Plain 'R2 bucket name'
  $accessKey = Read-Secret 'R2 access key id'
  $secretKey = Read-Secret 'R2 secret access key'

  Confirm-Target

  Write-Host ''
  Write-Host 'Storing credentials'
  Set-Secret -Name 'R2_ACCESS_KEY_ID' -Value $accessKey
  Set-Secret -Name 'R2_SECRET_ACCESS_KEY' -Value $secretKey

  # ONE call: env.ts requires all four together, so a two-step bind leaves a revision that cannot boot.
  Write-Host ''
  Write-Host "Binding to $Service"
  $ok = Invoke-Gcloud -GcArgs @(
    'run', 'services', 'update', $Service, "--region=$Region", "--project=$Project",
    '--update-secrets=R2_ACCESS_KEY_ID=R2_ACCESS_KEY_ID:latest,R2_SECRET_ACCESS_KEY=R2_SECRET_ACCESS_KEY:latest',
    "--update-env-vars=R2_ACCOUNT_ID=$accountId,R2_BUCKET=$bucket",
    '--quiet'
  )
  if (-not $ok) { throw 'the services update failed - nothing was bound' }

  Write-Host ''
  Write-Host 'Done. Verify: file endpoints should stop answering 503.' -ForegroundColor Green
  Write-Host '  node scripts/verify-deployment.mjs'
}

function Invoke-Vapid {
  Write-Host @'

VAPID - Web Push for reminders (RFC 8292)
-----------------------------------------
Generate the pair FIRST, in another window, and keep it out of any transcript:

    node scripts/generate-vapid-keys.mjs

Use that script, not `web-push --generate-vapid-keys`: webpush-webcrypto encodes its private key in
its own format, and a pair from elsewhere will not load.

'@
  # The public key is public by design - served to browsers by GET /api/v1/push/public-key - so it is
  # echoed, which also lets you eyeball it against the generator's output.
  $publicKey = Read-Plain 'VAPID public key'
  $subject = Read-Plain 'VAPID subject (mailto:you@example.com)'
  $privateKey = Read-Secret 'VAPID private key'

  Confirm-Target

  Write-Host ''
  Write-Host 'Storing credentials'
  Set-Secret -Name 'VAPID_PRIVATE_KEY' -Value $privateKey

  Write-Host ''
  Write-Host "Binding to $Service"
  $ok = Invoke-Gcloud -GcArgs @(
    'run', 'services', 'update', $Service, "--region=$Region", "--project=$Project",
    '--update-secrets=VAPID_PRIVATE_KEY=VAPID_PRIVATE_KEY:latest',
    "--update-env-vars=VAPID_PUBLIC_KEY=$publicKey,VAPID_SUBJECT=$subject",
    '--quiet'
  )
  if (-not $ok) { throw 'the services update failed - nothing was bound' }

  Write-Host ''
  Write-Host 'Done. Verify the endpoint returns a key rather than null:' -ForegroundColor Green
  Write-Host '  curl.exe -s https://api.mevivek.dev/api/v1/push/public-key'
}

function Invoke-Neon {
  Write-Host @'

Neon credential rotation (debt D18)
-----------------------------------
The current credential was exposed in a chat transcript and is unrotated. Neon's free tier has no IP
allowlist, so the string alone is full read/write/drop. Its trigger is "before the first real
document is stored" - so do this BEFORE putting real documents in.

Reset the role password in the Neon console first, then paste both connection strings here.
Remember to update apps/api/.env too; verify-deployment.mjs reads DATABASE_URL_UNPOOLED from it.

'@
  $pooled = Read-Secret 'new DATABASE_URL (pooled)'
  $unpooled = Read-Secret 'new DATABASE_URL_UNPOOLED (direct)'

  Confirm-Target

  Write-Host ''
  Write-Host 'Storing credentials'
  Set-Secret -Name 'DATABASE_URL' -Value $pooled
  Set-Secret -Name 'DATABASE_URL_UNPOOLED' -Value $unpooled

  Write-Host ''
  Write-Host "Binding to $Service"
  $ok = Invoke-Gcloud -GcArgs @(
    'run', 'services', 'update', $Service, "--region=$Region", "--project=$Project",
    '--update-secrets=DATABASE_URL=DATABASE_URL:latest,DATABASE_URL_UNPOOLED=DATABASE_URL_UNPOOLED:latest',
    '--quiet'
  )
  if (-not $ok) { throw 'the services update failed - nothing was bound' }

  Write-Host ''
  Write-Host 'Done. The API migrates on boot (ADR-0023), so a healthy revision means it connected.' -ForegroundColor Green
  Write-Host '  curl.exe -s https://api.mevivek.dev/api/v1/health'
  Write-Host ''
  Write-Host 'Then mark D18 closed in docs/product/review.md AND security-model.md section 7 - both lists.'
}

function Show-Status {
  Write-Host ''
  Write-Host "Secrets in $Project"
  # Get-GcloudValue, not Invoke-Gcloud: the latter returns a boolean, which would print as "True".
  $secrets = Get-GcloudValue -GcArgs @('secrets', 'list', "--project=$Project", '--format=value(name)')
  if ($secrets) { $secrets -split '\r?\n' | ForEach-Object { Write-Host "  $_" } }
  else { Write-Host '  (none readable)' }

  Write-Host ''
  Write-Host "Bound to $Service (names only, no values)"
  Get-BoundEnvNames | ForEach-Object { Write-Host "  $_" }
}

switch ($Command) {
  'preflight' { Invoke-Preflight }
  'r2' { Invoke-R2 }
  'vapid' { Invoke-Vapid }
  'neon' { Invoke-Neon }
  'status' { Show-Status }
  default {
    Write-Host @'
usage: .\scripts\provision.ps1 <preflight|r2|vapid|neon|status>

  preflight  check auth, project, service and permissions - writes nothing. START HERE.
  r2         bind the four R2_* values      (also set bucket CORS - see README)
  vapid      bind the three VAPID_* values  (run scripts/generate-vapid-keys.mjs first)
  neon       rotate the database credential (debt D18 - before the first real document)
  status     show what is bound, names only

Override the target with -Project, -Region, -Service, -RuntimeSA if it ever moves.
'@
    exit 1
  }
}
