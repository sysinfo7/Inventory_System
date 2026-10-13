$ErrorActionPreference = 'Stop'
Push-Location (Split-Path -Parent $PSScriptRoot)
try {
    if (-not (Test-Path -LiteralPath '.env')) {
        throw 'Missing .env. Copy .env.example to .env and replace both password placeholders first.'
    }
    docker info --format '{{.ServerVersion}}'
    if ($LASTEXITCODE -ne 0) { throw 'Cannot access Docker. Ensure Docker Desktop is running and this terminal can access its engine.' }
    docker compose up -d --wait
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL startup failed.' }
    npm.cmd run db:migrate
    if ($LASTEXITCODE -ne 0) { throw 'Database migration failed.' }
    npm.cmd run db:check
    if ($LASTEXITCODE -ne 0) { throw 'Database connection check failed.' }
    Write-Host 'Inventory database is ready on localhost:5433.'
} finally {
    Pop-Location
}
