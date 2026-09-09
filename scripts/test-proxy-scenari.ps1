# TASK 0.3 — PROXY SECURITY TEST REALI
# Scenari:
#  A) CSRF  → 3x POST senza csrf → 403 csrf_mismatch
#  B) RATE → 12 GET su booking pattern (<60s) → #11/#12 → 429 retry-after
#  C) HOST → GET con Host: evil-attacker.com → 400 invalid_host

$BASE = "http://localhost:3000"
$BOOKING_URL = "$BASE/s/velora-prod-acceptance-studio/booking"
$LOGIN_URL = "$BASE/login"
$ARTIFACTS_DIR = "$PSScriptRoot\..\artifacts\fase0"
$REPORT = Join-Path $ARTIFACTS_DIR "task-0.3-proxy-report.json"

if (-not (Test-Path $ARTIFACTS_DIR)) { New-Item -ItemType Directory -Force -Path $ARTIFACTS_DIR | Out-Null }

$results = [ordered]@{
  startedAt = (Get-Date).ToUniversalTime().ToString("o")
  baseUrl   = $BASE
  tests     = @()
  summary   = $null
}

function Add-TestResult {
  param($id, $label, $expected, $got, [bool]$pass)
  $results.tests += [ordered]@{
    id       = $id
    label    = $label
    expected = $expected
    got      = $got
    pass     = $pass
  }
  $color = if ($pass) { "Green" } else { "Red" }
  Write-Host -ForegroundColor $color ("TEST {0,-3} => {1}" -f $id, $(if ($pass) { "PASS" } else { "FAIL" }))
  if (-not $pass) { Write-Host ("     EXP: {0}`n     GOT: {1}" -f $expected, ($got | ConvertTo-Json -Compress)) }
}

Write-Host "======= FASE 0 — TASK 0.3: PROXY SECURITY SCENARI =======" -ForegroundColor Cyan
Write-Host "  BASE: $BASE"
Write-Host ""

# ============================================================
# PRE-CHECK: Server UP?
# ============================================================
try {
  $resp = Invoke-WebRequest -Uri $BASE -Method GET -UseBasicParsing -TimeoutSec 8 -ErrorAction Stop
  Write-Host ("PRE-CHECK server UP: {0}" -f $resp.StatusCode)
} catch {
  Write-Host ("PRE-CHECK ERRORE server non raggiungibile: {0}" -f $_.Exception.Message) -ForegroundColor Red
  $results.summary = [ordered]@{ total = 0; passed = 0; failed = 0; allPassed = $false; error = "server down" }
  $results.endedAt = (Get-Date).ToUniversalTime().ToString("o")
  $results | ConvertTo-Json -Depth 6 | Set-Content -Path $REPORT -Encoding UTF8
  exit 1
}

# ============================================================
# SCENARIO C — EVIL HOST  → 400 invalid_host
# ============================================================
Write-Host "--- Scenario C: EVIL HOST ---"
try {
  $headers = @{ "Host" = "evil-attacker.com" }
  $resp = Invoke-WebRequest -Uri "$BASE/login" -Method GET -Headers $headers -UseBasicParsing -TimeoutSec 8 -ErrorAction Stop
  $code = $resp.StatusCode
  $body = if ($resp.Content) { $resp.Content.Substring(0, [Math]::Min(500, $resp.Content.Length)) } else { "" }
  $got = [ordered]@{ status = $code; body = $body }
  Add-TestResult -id "C.1" -label "Host=evil-attacker.com /login GET" -expected "status=400 invalid_host" -got $got -pass ($code -eq 400)
} catch {
  $webResp = $_.Exception.Response
  $code = if ($webResp) { [int]$webResp.StatusCode } else { 0 }
  $body = ""
  try {
    if ($webResp) {
      $sr = New-Object System.IO.StreamReader($webResp.GetResponseStream())
      $body = $sr.ReadToEnd()
      if ($body.Length -gt 500) { $body = $body.Substring(0, 500) }
    }
  } catch {}
  $bodyParsed = $null
  try { $bodyParsed = $body | ConvertFrom-Json } catch {}
  $got = [ordered]@{ status = $code; body = $body; error_code = $bodyParsed.error }
  $pass = ($code -eq 400) -and ($bodyParsed -and $bodyParsed.error -eq "invalid_host")
  Add-TestResult -id "C.1" -label "Host=evil-attacker.com /login GET" -expected "status=400 error=invalid_host" -got $got -pass $pass
}

# ============================================================
# SCENARIO A — CSRF: 3x POST booking senza token → 403
# ============================================================
Write-Host "--- Scenario A: CSRF NO TOKEN ---"
# 1) warm-up GET per ricevere cookie CSRF HttpOnly (prossimo step ne usiamo uno qualsiasi)
try {
  $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $warm = Invoke-WebRequest -Uri $BOOKING_URL -Method GET -WebSession $session -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
  Write-Host ("  warm-up booking GET: {0}" -f $warm.StatusCode)
} catch {
  Write-Host ("  warm-up failed: {0}" -f $_.Exception.Message)
}

$UA = "Mozilla/5.0 (proxy-test) VELORA-FASE0/1.0"
for ($i = 1; $i -le 3; $i++) {
  try {
    $headers = @{ "User-Agent" = $UA; "Accept" = "application/json" }
    $body = "privacy_accepted=1&service_id=dummy"
    $resp = Invoke-WebRequest -Uri $BOOKING_URL -Method POST -Headers $headers -Body $body -ContentType "application/x-www-form-urlencoded" -UseBasicParsing -TimeoutSec 8 -ErrorAction Stop
    $code = $resp.StatusCode
    $respBody = if ($resp.Content) { $resp.Content.Substring(0, [Math]::Min(300, $resp.Content.Length)) } else { "" }
    Add-TestResult -id ("A.{0}" -f $i) -label ("POST booking #{0} SENZA CSRF header/cookie" -f $i) -expected "status=403 error=csrf_mismatch" -got ([ordered]@{ status = $code; body = $respBody }) -pass $false
  } catch {
    $webResp = $_.Exception.Response
    $code = if ($webResp) { [int]$webResp.StatusCode } else { 0 }
    $body = ""
    try {
      if ($webResp) {
        $sr = New-Object System.IO.StreamReader($webResp.GetResponseStream())
        $body = $sr.ReadToEnd()
        if ($body.Length -gt 300) { $body = $body.Substring(0, 300) }
      }
    } catch {}
    $errJson = $null
    try { $errJson = $body | ConvertFrom-Json } catch {}
    $got = [ordered]@{ status = $code; error_code = $(if ($errJson) { $errJson.error } else { $null }); body = $body }
    $pass = ($code -eq 403) -and ($errJson -and $errJson.error -eq "csrf_mismatch")
    Add-TestResult -id ("A.{0}" -f $i) -label ("POST booking #{0} SENZA CSRF header/cookie" -f $i) -expected "status=403 error=csrf_mismatch" -got $got -pass $pass
  }
}

# ============================================================
# SCENARIO B — RATE LIMIT: 12 GET su /s/.../booking (< 60s)
# 10 ok, #11 e #12 → 429 retry-after
# ============================================================
Write-Host "--- Scenario B: RATE LIMIT 10/min booking pattern ---"
$okBefore = 0
$statuses = @()
$first429 = $null
$FIXED_UA = "$UA RATE-FIXED-CLIENT-001"
for ($i = 1; $i -le 12; $i++) {
  try {
    $headers = @{ "User-Agent" = $FIXED_UA; "Accept" = "application/json" }
    $resp = Invoke-WebRequest -Uri $BOOKING_URL -Method GET -Headers $headers -UseBasicParsing -TimeoutSec 8 -ErrorAction Stop
    $code = $resp.StatusCode
    $statuses += [ordered]@{ n = $i; status = $code }
    if ($code -eq 200) { $okBefore++ }
    Write-Host ("  GET #{0,-2}: {1}" -f $i, $code)
  } catch {
    $webResp = $_.Exception.Response
    $code = if ($webResp) { [int]$webResp.StatusCode } else { 0 }
    $retry = if ($webResp -and $webResp.Headers["Retry-After"]) { $webResp.Headers["Retry-After"] } else { $null }
    $body = ""
    try {
      if ($webResp) {
        $sr = New-Object System.IO.StreamReader($webResp.GetResponseStream())
        $body = $sr.ReadToEnd()
      }
    } catch {}
    $j = $null
    try { $j = $body | ConvertFrom-Json } catch {}
    $err = if ($j) { $j.error } else { $null }
    $statuses += [ordered]@{ n = $i; status = $code; retry_after = $retry; error_code = $err }
    if ($code -eq 429 -and -not $first429) { $first429 = $i }
    Write-Host -ForegroundColor $(if ($code -eq 429) { "Yellow" } else { "Red" }) ("  GET #{0,-2}: {1}{2}" -f $i, $code, $(if ($retry) { " Retry-After=$retry" } else { "" }))
  }
}
# Verifica: ci sono almeno due 429 dopo la posizione >=11
$count429 = @($statuses | Where-Object { $_.status -eq 429 }).Count
$lastOk = 0
for ($k = 0; $k -lt $statuses.Count; $k++) {
  if ($statuses[$k].status -eq 200) { $lastOk = $k + 1 }
}
$bPass = ($count429 -ge 2) -and ($first429 -ne $null) -and ($first429 -ge 11)
Add-TestResult -id "B.1" -label "GET booking 12x < 60s: #11/#12 = 429 + retry-after header" -expected "count429 >=2 AND first429 tra 11 e 12" -got ([ordered]@{ statuses = $statuses; ok_before_limit = $okBefore; first_429_at = $first429; count_429 = $count429; last_ok_at = $lastOk }) -pass $bPass

# ============================================================
# SUMMARY
# ============================================================
$total = $results.tests.Count
$passed = @($results.tests | Where-Object { $_.pass -eq $true }).Count
$failed = $total - $passed
$results.summary = [ordered]@{
  total     = $total
  passed    = $passed
  failed    = $failed
  allPassed = ($failed -eq 0)
}
$results.endedAt = (Get-Date).ToUniversalTime().ToString("o")

Write-Host ""
Write-Host "==================== SUMMARY ====================" -ForegroundColor Cyan
Write-Host ("Totale test : {0}" -f $total)
Write-Host ("Passati     : {0}" -f $passed) -ForegroundColor Green
Write-Host ("Falliti     : {0}" -f $failed) -ForegroundColor $(if ($failed -gt 0) { "Red" } else { "Green" })
Write-Host ("Esito       : {0}" -f $(if ($results.summary.allPassed) { "ALL PASSED ✅" } else { "SOME FAILED ❌" })) -ForegroundColor $(if ($results.summary.allPassed) { "Green" } else { "Red" })
Write-Host ("Report JSON : {0}" -f $REPORT)
Write-Host "=================================================="

$results | ConvertTo-Json -Depth 8 | Set-Content -Path $REPORT -Encoding UTF8

exit $(if ($results.summary.allPassed) { 0 } else { 1 })
