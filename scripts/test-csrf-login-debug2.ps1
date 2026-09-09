$ErrorActionPreference = "Stop"

$loginUrl = "http://localhost:3000/login"
$csrfCookieName = "velora_csrf_token"

Write-Host "=== STEP 1: GET /login per estrarre cookie CSRF ===" -ForegroundColor Cyan
$getResp = Invoke-WebRequest -Uri $loginUrl -Method GET -SessionVariable "session" -UseBasicParsing
Write-Host "GET status: $($getResp.StatusCode)"
$cookies = $session.Cookies.GetCookies($loginUrl)
$csrfCookie = $cookies | Where-Object { $_.Name -eq $csrfCookieName } | Select-Object -First 1
$csrfValue = $csrfCookie.Value
Write-Host "CSRF cookie OK. Lunghezza: $($csrfValue.Length)"
Write-Host ""

Write-Host "=== STEP 2: POST /login con FORM BODY corretto ===" -ForegroundColor Cyan
$postParams = @{
    "_csrf" = $csrfValue
    "email" = "admin@velora.studio"
    "password" = "admin123"
}

try {
    $postResp = Invoke-WebRequest -Uri $loginUrl -Method POST -Body $postParams -WebSession $session -UseBasicParsing -ContentType "application/x-www-form-urlencoded"
    $statusCode = [int]$postResp.StatusCode
    $body = $postResp.Content
    Write-Host "POST status: $statusCode"
    Write-Host "Location: $($postResp.Headers['Location'])"
    Write-Host "Set-Cookie (primi 200): $($postResp.Headers['Set-Cookie'] -join '; ' | Out-String).Substring(0, [Math]::Min(200, ($postResp.Headers['Set-Cookie'] -join '; ').Length))"
} catch {
    $statusCode = [int]$_.Exception.Response.StatusCode
    $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
    $body = $reader.ReadToEnd()
    Write-Host "POST status: $statusCode (EXCEPTION)"
}

Write-Host ""
Write-Host "=== CERCO MESSAGGIO ERRORE O REDIRECT ===" -ForegroundColor Cyan

if ($body -match 'role="alert"[^>]*>([^<]+)<') {
    Write-Host "Trovato role=alert: $($Matches[1])" -ForegroundColor Yellow
} elseif ($body -match 'class="alert"[^>]*>([^<]+)<') {
    Write-Host "Trovato class=alert: $($Matches[1])" -ForegroundColor Yellow
} elseif ($body -match "Accedi alla tua area riservata") {
    Write-Host "Pagina di login ancora mostrata (action fallita, nessun redirect)." -ForegroundColor Yellow
} elseif ($body -match "Dashboard" -or $body -match "dashboard") {
    Write-Host "Trovato 'Dashboard' nel body, login riuscito." -ForegroundColor Green
}

Write-Host ""
Write-Host "=== PRIMI 1800 CARATTERI HTML RISPOSTA ==="
$body.Substring(0, [Math]::Min(1800, $body.Length))
