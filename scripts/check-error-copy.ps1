# Pre-release gate for user-facing errors.
#
# Two copy failures shipped in 2.2.14 and both reached the retry card: a raw provider payload shown
# as the message, and a refused connection reported without saying what refused it. Neither breaks
# a type or a unit test written after the fact, so they get a standing gate: run the message
# suites, then drive the real executor against a closed port and a Google-style 503 and assert
# what a user would read.
#
#   pwsh -File scripts/check-error-copy.ps1
#
# Exit code 0 means the copy is safe to ship.
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Invoke-Step([string]$Name, [scriptblock]$Step) {
  Write-Host "check     $Name"
  & $Step
  if ($LASTEXITCODE -ne 0) { throw "Gate failed: $Name" }
}

Invoke-Step "provider error copy" {
  bun test --cwd packages/ai test/error-copy.test.ts test/provider-error.test.ts --timeout 30000
}

Invoke-Step "executor and transport copy" {
  bun test --cwd packages/ai test/executor.test.ts test/http-timeout.test.ts --timeout 30000
}

Invoke-Step "session error copy" {
  bun test --cwd packages/core test/session-runner-retry.test.ts test/session-error.test.ts --timeout 30000
}

Invoke-Step "retry card truncation" {
  bun test --cwd packages/session-ui src/components/retry-message.test.ts --timeout 30000
}

Invoke-Step "live endpoints" {
  bun packages/ai/test/error-copy.smoke.ts
}

Write-Host "ok        error copy"
