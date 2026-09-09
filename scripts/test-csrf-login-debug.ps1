$ErrorActionPreference = "Stop"

$loginUrl = "http://localhost:3000/login"
$csrfCookieName = "velora_csrf_token"

Write-Host "=== STEP 1: GET /login per estrarre cookie CSRF ===" -ForegroundColor Cyan
try {
    $getResp = Invoke-WebRequest -Uri $loginUrl -Method GET -SessionVariable "session" -UseBasicParsing
    Write-Host "GET status: $($getResp.StatusCode)"
    $cookies = $session.Cookies.GetCookies($loginUrl)
    $csrfCookie = $cookies | Where-Object { $_.Name -eq $csrfCookieName } | Select-Object -First 1
    if (-not $csrfCookie) {
        Write-Host "ERRORE: Cookie $csrfCookieName NON trovato nella risposta GET!" -ForegroundColor Red
        Write-Host "Tutti i cookie:"
        $cookies | ForEach-Object { Write-Host "  $($_.Name) = $($_.Value.Substring(0, [Math]::Min(20, $_.Value.Length)))..." }
        exit 1
    }
    $csrfValue = $csrfCookie.Value
    Write-Host "CSRF cookie OK. Valore (primi 20 chars): $($csrfValue.Substring(0, [Math]::Min(20, $csrfValue.Length)))..."
    Write-Host "Lunghezza token: $($csrfValue.Length)"
    Write-Host ""
} catch {
    Write-Host "GET fallito: $_" -ForegroundColor Red
    exit 1
}

Write-Host "=== STEP 2: POST /login con FORM BODY _csrf (corretto) ===" -ForegroundColor Cyan
$postParams = @{
    "_csrf" = $csrfValue
    "email" = "admin@velora.studio"
    "password" = "admin123"
}

try {
    $postResp = Invoke-WebRequest -Uri $loginUrl -Method POST -Body $postParams -WebSession $session -UseBasicParsing -ContentType "application/x-www-form-urlencoded"
    Write-Host "POST status: $($postResp.StatusCode)" -ForegroundColor Green
    Write-Host "Location header (redirect): $($postResp.Headers['Location'])"
    Write-Host "Content-Type risposta: $($postResp.Headers['Content-Type'])"
    Write-Host ""
    Write-Host "=== SUCCESSO: Login CSRF OK ===" -ForegroundColor Green
    exit 0
} catch {
    $resp = $_.Exception.Response
    if ($resp) {
        $statusCode = [int]$resp.StatusCode
        Write-Host "POST status code: $statusCode" -ForegroundColor Yellow
        try {
            $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
            $body = $reader.ReadToEnd()
            Write-Host "--- RISPOSTA BODY ---"
            Write-Host $body
            Write-Host "--- FINE BODY ---"
        } catch {}
        if ($statusCode -eq 403) {
            Write-Host ""
            Write-Host "DIAGNOSI: 403 csrf_mismatch - confronta:" -ForegroundColor Yellow
            Write-Host "  Cookie CSRF (len $($csrfValue.Length)): $($csrfValue.Substring(0,[Math]::Min(30,$csrfValue.Length)))"
            Write-Host "  _csrf inviato (len $($csrfValue.Length)): $($csrfValue.Substring(0,[Math]::Min(30,$csrfValue.Length)))"
        }
    } else {
        Write-Host "POST fallito senza response: $_" -ForegroundColor Red
    }
    exit 1
}
