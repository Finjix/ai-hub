$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root

function Get-DevListeners {
    # Enumerating all listeners also works when neither development port is in use.
    @(Get-NetTCPConnection -State Listen -ErrorAction Stop |
        Where-Object { $_.LocalPort -in @(3000, 3001) })
}

try {
    if (-not (Get-Command node.exe -ErrorAction SilentlyContinue) -or
        -not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
        throw 'Install Windows x64 Node.js 24.21.0 and ensure node/npm are on PATH.'
    }
    if (-not (Test-Path -LiteralPath "$root\node_modules\next\dist\bin\next")) {
        throw 'Dependencies are missing. Run npm ci in the project directory first.'
    }
    if (-not (Test-Path -LiteralPath "$root\node_modules\electron\dist\electron.exe")) {
        throw 'Electron is missing. Run npm ci or node node_modules/electron/install.js first.'
    }

    $processes = @(Get-CimInstance Win32_Process)
    $byId = @{}
    $devIds = @{}
    foreach ($process in $processes) {
        $byId[[int]$process.ProcessId] = $process
        $command = [string]$process.CommandLine
        $inProject = $command.IndexOf($root, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
            $command.IndexOf($root.Replace('\', '/'), [StringComparison]::OrdinalIgnoreCase) -ge 0
        # Never terminate all node.exe/electron.exe processes on the machine.
        $isRuntime = $process.Name -in @('node.exe', 'electron.exe')
        $isDevWindow = $process.Name -eq 'cmd.exe' -and
            $command -match 'npm(?:\.cmd)? run dev:(server|desktop)'
        if ($inProject -and ($isRuntime -or $isDevWindow)) {
            $devIds[[int]$process.ProcessId] = $true
        }
    }

    # Refuse unrelated port owners rather than silently killing another application.
    foreach ($listener in (Get-DevListeners)) {
        $ownerId = [int]$listener.OwningProcess
        $ancestorId = $ownerId
        $seen = @{}
        $belongsToProject = $false
        while ($byId.ContainsKey($ancestorId) -and -not $seen.ContainsKey($ancestorId)) {
            $seen[$ancestorId] = $true
            if ($devIds.ContainsKey($ancestorId)) {
                $belongsToProject = $true
                break
            }
            $ancestorId = [int]$byId[$ancestorId].ParentProcessId
        }
        if (-not $belongsToProject) {
            throw "Port $($listener.LocalPort) is occupied by another application (PID $ownerId). Close it and retry."
        }
    }

    # Kill the highest matching ancestors, including their Next.js/Electron children.
    foreach ($processId in @($devIds.Keys)) {
        $ancestorId = [int]$byId[$processId].ParentProcessId
        $seen = @{}
        $hasDevParent = $false
        while ($byId.ContainsKey($ancestorId) -and -not $seen.ContainsKey($ancestorId)) {
            $seen[$ancestorId] = $true
            if ($devIds.ContainsKey($ancestorId)) {
                $hasDevParent = $true
                break
            }
            $ancestorId = [int]$byId[$ancestorId].ParentProcessId
        }
        if (-not $hasDevParent -and (Get-Process -Id $processId -ErrorAction SilentlyContinue)) {
            Write-Host "Stopping existing development process tree (PID $processId)..."
            & taskkill.exe /PID $processId /T /F
            if ($LASTEXITCODE -ne 0 -and (Get-Process -Id $processId -ErrorAction SilentlyContinue)) {
                throw "Unable to stop PID $processId. Close its window or retry with appropriate permissions."
            }
        }
    }

    $deadline = (Get-Date).AddSeconds(15)
    while (@(Get-DevListeners).Count -gt 0) {
        if ((Get-Date) -ge $deadline) {
            throw 'Ports 3000/3001 are still occupied after stopping the old processes.'
        }
        Start-Sleep -Milliseconds 300
    }

    Write-Host 'Starting server and desktop in this window. Press Ctrl+C to stop both.'
    Write-Host 'Admin: http://localhost:3000/admin'
    Write-Host 'Desktop server URL: http://127.0.0.1:3000'
    & node.exe "$root\scripts\dev-all.mjs"
    if ($LASTEXITCODE -ne 0) {
        throw "Development processes exited with code $LASTEXITCODE."
    }
} catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
