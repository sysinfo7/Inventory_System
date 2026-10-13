$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $repositoryRoot '.env'
if (-not (Test-Path -LiteralPath $envPath)) {
    throw 'Missing .env. Copy .env.example to .env and configure the local database first.'
}

$lines = [System.IO.File]::ReadAllLines($envPath)
$appLineIndex = -1
for ($index = 0; $index -lt $lines.Length; $index++) {
    if ($lines[$index] -match '^\s*APP_DATABASE_URL\s*=') {
        $appLineIndex = $index
        break
    }
}

if ($appLineIndex -ge 0) {
    $currentAppUrl = $lines[$appLineIndex] -replace '^\s*APP_DATABASE_URL\s*=', ''
    if ($currentAppUrl -and $currentAppUrl -notmatch 'replace-with-a-different-long-random-password') {
        throw 'APP_DATABASE_URL is already configured; this script will not replace an existing app credential.'
    }
}

# Generate a distinct 256-bit URL-safe password without printing it to the terminal.
$bytes = [byte[]]::new(32)
$random = [Security.Cryptography.RandomNumberGenerator]::Create()
try {
    $random.GetBytes($bytes)
} finally {
    $random.Dispose()
}
$password = [Convert]::ToHexString($bytes).ToLowerInvariant()
$appUrlLine = "APP_DATABASE_URL=postgresql://inventory_runtime:$password@localhost:5433/inventory"

if ($appLineIndex -ge 0) {
    $lines[$appLineIndex] = $appUrlLine
} else {
    $lines = @($lines) + @($appUrlLine)
}

[System.IO.File]::WriteAllLines($envPath, $lines, [System.Text.UTF8Encoding]::new($false))
Write-Host 'A separate local app connection URL was saved to the git-ignored .env file. The password was not displayed.'
