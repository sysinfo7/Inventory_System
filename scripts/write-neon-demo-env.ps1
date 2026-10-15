$ErrorActionPreference = 'Stop'

function ConvertFrom-SecureInput([Security.SecureString] $value) {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($value)
    try {
        [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
}

try {
    # Secure prompts hide connection strings as they are pasted into PowerShell.
    Write-Host 'Paste the NEW direct Neon owner URL. Input is hidden.'
    $directSecure = Read-Host -AsSecureString
    Write-Host 'Paste the NEW pooled Neon owner URL. Input is hidden.'
    $pooledSecure = Read-Host -AsSecureString

    $directText = ConvertFrom-SecureInput $directSecure
    $pooledText = ConvertFrom-SecureInput $pooledSecure
    # Migrations need the direct endpoint; app requests use the pooled endpoint.
    $direct = [Uri]$directText
    $pooledOwner = [Uri]$pooledText

    $directHostOkay = $direct.Host -match '^ep-.+\.neon\.tech$' -and $direct.Host -notmatch '-pooler\.'
    $pooledHostOkay = $pooledOwner.Host -match '^ep-.+-pooler\..+\.neon\.tech$'
    $tlsPattern = '(?:^|&)sslmode=(require|verify-ca|verify-full)(?:&|$)'
    $tlsOkay = $direct.Query.TrimStart('?') -match $tlsPattern -and $pooledOwner.Query.TrimStart('?') -match $tlsPattern
    $sameEndpoint = ($direct.Host -replace '-pooler(?=\.)', '') -eq ($pooledOwner.Host -replace '-pooler(?=\.)', '')
    $sameDatabase = $direct.AbsolutePath -eq $pooledOwner.AbsolutePath -and $direct.AbsolutePath -ne '/'

    if (-not ($directHostOkay -and $pooledHostOkay -and $tlsOkay -and $sameEndpoint -and $sameDatabase)) {
        throw 'The URLs must be the fresh direct and pooled endpoints for the same Neon database, both with TLS enabled.'
    }

    # Pin certificate verification explicitly to avoid driver-default changes.
    $directBuilder = [UriBuilder]$direct
    $directBuilder.Query = $direct.Query.TrimStart('?') -replace '(?i)(^|&)sslmode=(require|verify-ca|verify-full)(?=&|$)', '$1sslmode=verify-full'
    $pooledBuilder = [UriBuilder]$pooledOwner
    $pooledBuilder.Query = $pooledOwner.Query.TrimStart('?') -replace '(?i)(^|&)sslmode=(require|verify-ca|verify-full)(?=&|$)', '$1sslmode=verify-full'

    # Give the app a new password instead of reusing the database-owner password.
    $randomBytes = New-Object byte[] 32
    $random = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $random.GetBytes($randomBytes)
    } finally {
        $random.Dispose()
    }
    $runtimePassword = [Convert]::ToBase64String($randomBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
    [Array]::Clear($randomBytes, 0, $randomBytes.Length)

    $runtimeUrl = [UriBuilder]$pooledBuilder.Uri
    $runtimeUrl.UserName = 'inventory_runtime'
    $runtimeUrl.Password = $runtimePassword

    # Store credentials only in the repository's Git-ignored local config file.
    $target = Join-Path (Get-Location) '.env.neon-demo'
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllLines($target, [string[]]@(
        "DATABASE_URL=$($directBuilder.Uri.AbsoluteUri)",
        "APP_DATABASE_URL=$($runtimeUrl.Uri.AbsoluteUri)"
    ), $encoding)

    git check-ignore --quiet -- '.env.neon-demo'
    if ($LASTEXITCODE -ne 0) {
        Remove-Item -LiteralPath $target -Force
        throw 'The config file is not ignored by Git; it was removed. Check the repository .gitignore.'
    }

    Write-Host 'Created the ignored Neon demo config. The app URL uses a newly generated inventory_runtime password; no credentials were displayed.'
} catch {
    Write-Error 'Could not prepare the local Neon config. Check the copied URLs and try again; no credentials were displayed.'
    exit 1
} finally {
    $directSecure = $null
    $pooledSecure = $null
    $directText = $null
    $pooledText = $null
    $runtimePassword = $null
    $runtimeUrl = $null
}
