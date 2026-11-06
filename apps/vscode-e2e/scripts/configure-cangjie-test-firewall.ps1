param(
    [Parameter(Mandatory = $true)][string]$EvaluationRoot,
    [switch]$PlanOnly
)
$ErrorActionPreference = 'Stop'
$evalRoot = [IO.Path]::GetFullPath($EvaluationRoot).TrimEnd([char]'\', [char]'/')
$repositoryBin = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../bin'))
if (-not $evalRoot.StartsWith($repositoryBin + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'EvaluationRoot must be a subdirectory of this repository bin directory.' }
$evalQueue = Join-Path $evalRoot 'firewall-queue'
$evalState = Join-Path $evalRoot 'firewall-helper-state.json'
$evalGroup = 'NJUST-Cangjie-Eval-' + [Guid]::NewGuid().ToString('N')
$evalRules = [System.Collections.Generic.List[object]]::new()
if ($PlanOnly) {
    @{ programs = 'Only exact target/release/unittest_bin/std.testrunner.exe paths below this evaluation directory'; root = $evalRoot; direction = 'Inbound'; protocol = 'TCP'; remoteAddress = '127.0.0.1'; profile = 'Any'; cleanup = 'Remove only rules created by this helper when firewall.stop is present'; manualEnvironmentIntervention = 'One administrator UAC confirmation' } | ConvertTo-Json
    exit 0
}
$evalPrincipal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $evalPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'An administrator token is required to create exact loopback firewall rules.' }
[IO.Directory]::CreateDirectory($evalQueue) | Out-Null
function Save-EvalState($status) {
    @{ status = $status; group = $evalGroup; rules = @($evalRules.ToArray()); manualEnvironmentIntervention = 'Administrator UAC setup'; at = [DateTime]::UtcNow.ToString('o') } | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 -LiteralPath $evalState
}
function Write-EvalAck([string]$ackPath, $content) {
    $temporary = $ackPath + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
    $content | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 -LiteralPath $temporary
    Move-Item -LiteralPath $temporary -Destination $ackPath -ErrorAction Stop
}
Save-EvalState 'running'
try {
    while (-not (Test-Path -LiteralPath (Join-Path $evalRoot 'firewall.stop'))) {
        foreach ($requestFile in @(Get-ChildItem -LiteralPath $evalQueue -Filter '*.json' -File)) {
            $ackPath = $requestFile.FullName + '.ack'
            if (Test-Path -LiteralPath $ackPath) { continue }
            try {
                $request = Get-Content -Raw -Encoding UTF8 -LiteralPath $requestFile.FullName | ConvertFrom-Json
                $requestRules = [System.Collections.Generic.List[object]]::new()
                foreach ($requestedProgram in @($request.programs)) {
                    $program = [IO.Path]::GetFullPath([string]$requestedProgram)
                    if (-not $program.StartsWith($evalRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or -not $program.EndsWith('\target\release\unittest_bin\std.testrunner.exe', [StringComparison]::OrdinalIgnoreCase)) { throw 'Request is outside the permitted generated test-runner scope.' }
                    $ruleName = $evalGroup + '-' + $evalRules.Count
                    New-NetFirewallRule -Name $ruleName -DisplayName $ruleName -Group $evalGroup -Program $program -Direction Inbound -Action Allow -Protocol TCP -RemoteAddress '127.0.0.1' -Profile Any -Enabled True | Out-Null
                    $record = @{ name = $ruleName; program = $program; remoteAddress = '127.0.0.1'; protocol = 'TCP' }
                    $evalRules.Add($record)
                    $requestRules.Add($record)
                }
                Write-EvalAck $ackPath @{ rules = @($requestRules.ToArray()); group = $evalGroup; environmentIntervention = 'Administrator UAC setup before evaluation'; automaticPerRunSetup = $true }
                Save-EvalState 'running'
            } catch {
                Write-EvalAck $ackPath @{ error = $_.Exception.Message }
            }
        }
        Start-Sleep -Milliseconds 250
    }
} finally {
    foreach ($rule in $evalRules) {
        try { Remove-NetFirewallRule -Name $rule.name -ErrorAction Stop } catch { Write-Warning $_.Exception.Message }
    }
    Save-EvalState 'stopped'
}
