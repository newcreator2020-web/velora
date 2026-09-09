&lt;#
.SYNOPSIS
  Rotazione sicura delle chiavi Supabase (Anon + Service Role) per Velora.

.DESCRIPTION
  Script conforme Punto 10 (SEGRETI) + BLOCKED_MCP Task A5:
  - NON legge MAI le chiavi da argomenti (evita leak PSReadLine history)
  - NON stampa MAI valori delle chiavi in stdout / error stream
  - Usa Read-Host -AsSecureString (input mascherato con asterischi)
  - Backup timestampato di .env PRIMA di qualsiasi modifica
  - Validazione minima formato JWT (prefisso eyJhbGci) SENZA esporre il valore
  - Replace in-place solo dopo backup completato
  - Messaggio ACTION_REQUIRED finale per riavvio servizi

  COME GENERARE NUOVE CHIAVI SUPABASE:
    1. Apri https://supabase.com/dashboard/project/uiekkhgspziozprxulit/settings/api
    2. Section "Project API keys" → clicca "Rotate" su ogni chiave
    3. Copia il nuovo valore ANON negli appunti (NON salvare in file)
    4. Avvia questo script: inserisci ANON → poi SERVICE ROLE
    5. Fatto. Riavvia pnpm dev e ri-esegui pnpm build.

.NOTES
  - Non usare -Verbose (rischia di loggare SecureString in PS 5.1)
  - Backup posizionato in .backup/env/{timestamp}/.env
  - Se qualcosa fallisce PRIMA del write, non viene toccato .env
#&gt;

[CmdletBinding(SupportsShouldProcess=$false)]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# === Percorsi e costanti (nessun segreto) ===
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$EnvPath     = Join-Path $ProjectRoot ".env"
$BackupRoot  = Join-Path $ProjectRoot (Join-Path ".backup" "env")
$Timestamp   = Get-Date -Format "yyyyMMdd_HHmmss"
$BackupDir   = Join-Path $BackupRoot $Timestamp

# Le chiavi JWT Supabase iniziano SEMPRE con questo prefisso (pubblico, non segreto)
$JwtPrefix = "eyJhbGci"

function Write-Step { param([string]$Msg) Write-Host "[+] $Msg" -ForegroundColor Cyan }
function Write-Warn { param([string]$Msg) Write-Host "[!] $Msg" -ForegroundColor Yellow }
function Write-Ok   { param([string]$Msg) Write-Host "[OK] $Msg" -ForegroundColor Green }
function Write-Fail { param([string]$Msg) Write-Host "[X] $Msg" -ForegroundColor Red; exit 1 }

# === 0. Prerequisito file .env ===
if (-not (Test-Path -LiteralPath $EnvPath -PathType Leaf)) {
  Write-Fail "File .env non trovato in '$EnvPath'. Esegui da root progetto."
}
Write-Step "Progetto root: $ProjectRoot"
Write-Step "File env:    .env"

# === 1. Backup .env PRIMA di QUALSIASI modifica ===
Write-Step "Creazione directory backup: .backup/env/$Timestamp/"
New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
Copy-Item -LiteralPath $EnvPath -Destination (Join-Path $BackupDir ".env") -Force
if (-not (Test-Path (Join-Path $BackupDir ".env"))) {
  Write-Fail "Backup fallito. Interrotto per sicurezza (nessuna modifica applicata)."
}
Write-Ok "Backup creato: .backup/env/$Timestamp/.env"

# === Helper: leggi SecureString → decodifica in MEMORIA → valida prefisso ===
# MAI scrivere la stringa piana in Write-Host / Write-Output.
function Read-ValidatedJwt {
  param(
    [Parameter(Mandatory)]
    [string]$Label,
    [Parameter(Mandatory)]
    [string]$EnvVarName
  )

  while ($true) {
    Write-Step "Inserisci NUOVO valore per '$EnvVarName' ($Label) — input MASCHERATO (CTRL+C per annullare):"
    $secure = Read-Host -AsSecureString

    if (-not $secure -or $secure.Length -eq 0) {
      Write-Warn "Input vuoto. Ripeti (oppure CTRL+C per uscire senza modifiche)."
      continue
    }

    # Decodifica transitoria SOLO per validazione + replace
    $bstr    = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    $plain   = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

    if (-not $plain.StartsWith($JwtPrefix, [System.StringComparison]::Ordinal)) {
      # IMPORTANTE: non citare neanche un carattere di $plain oltre al prefisso noto
      Write-Warn "Formato NON valido per JWT Supabase (atteso prefisso '$JwtPrefix...')."
      Write-Warn "Hai copiato la chiave corretta dal Dashboard Supabase → Settings → API?"
      $plain = $null
      continue
    }

    if ($plain.Length -lt 60) {
      Write-Warn "Lunghezza anomala (< 60 caratteri). Chiave probabilmente troncata. Ripeti."
      $plain = $null
      continue
    }

    return $plain
  }
}

# === 2. Lettura valori (utente inserisce da tastiera, asterischi) ===
Write-Host ""
Write-Warn "OTTIENI LE NUOVE CHIAVI DA: https://supabase.com/dashboard/project/uiekkhgspziozprxulit/settings/api"
Write-Warn "Sezione 'Project API keys' → tasto 'Rotate' → copia valori uno alla volta."
Write-Host ""

$newAnon       = Read-ValidatedJwt -Label "ANON key (pubblica, expose al browser)" -EnvVarName "NEXT_PUBLIC_SUPABASE_ANON_KEY"
$newServiceKey = Read-ValidatedJwt -Label "SERVICE ROLE key (PRIVATA — SUL SERVER SOLAMENTE)" -EnvVarName "SUPABASE_SERVICE_ROLE_KEY"

# MAI, in nessuna circostanza, fare Write-Host $newAnon o $newServiceKey.
# Anche in caso di errore restituisci solo codice errore e messaggio generico.

if ($newAnon -ceq $newServiceKey) {
  Write-Fail "ANON e SERVICE ROLE sono identiche. Devi usare due chiavi distinte dal Dashboard (ruoli diversi)."
}

# === 3. Replace in-memory del file .env (solo per le due righe note) ===
# Leggiamo riga per riga → sostituiamo solo se la riga inizia con il nome variabile esatto.
Write-Step "Aggiornamento .env in memoria (solo due variabili target)..."
$lines = Get-Content -LiteralPath $EnvPath

$anonFound   = $false
$svcFound    = $false
$newLines    = New-Object System.Collections.Generic.List[string]

foreach ($line in $lines) {
  if ($line.StartsWith("NEXT_PUBLIC_SUPABASE_ANON_KEY=", [System.StringComparison]::Ordinal)) {
    [void]$newLines.Add(("NEXT_PUBLIC_SUPABASE_ANON_KEY=" + $newAnon))
    $anonFound = $true
  }
  elseif ($line.StartsWith("SUPABASE_SERVICE_ROLE_KEY=", [System.StringComparison]::Ordinal)) {
    [void]$newLines.Add(("SUPABASE_SERVICE_ROLE_KEY=" + $newServiceKey))
    $svcFound = $true
  }
  else {
    [void]$newLines.Add($line)
  }
}

if (-not $anonFound) { Write-Fail "Riga NEXT_PUBLIC_SUPABASE_ANON_KEY NON trovata in .env. Nessuna modifica applicata. Backup preservato." }
if (-not $svcFound)  { Write-Fail "Riga SUPABASE_SERVICE_ROLE_KEY NON trovata in .env. Nessuna modifica applicata. Backup preservato." }

# === 4. Scrittura ATOMICA: prima .env.tmp, poi Move-Item sovrascrittura ===
$tmpPath = $EnvPath + ".tmp." + $Timestamp
try {
  Set-Content -LiteralPath $tmpPath -Value $newLines -Encoding utf8NoBOM -ErrorAction Stop
}
catch {
  Write-Fail "Scrittura file temporaneo fallita. .env INTATTO. Errore: $($_.Exception.Message)"
}

# Verifica minimamente che il file tmp non sia vuoto (corrotto?)
if ((Get-Item -LiteralPath $tmpPath).Length -lt 50) {
  Remove-Item -LiteralPath $tmpPath -Force -ErrorAction SilentlyContinue
  Write-Fail "File temporaneo troppo piccolo. Scrittura abortita — .env INTATTO."
}

try {
  Move-Item -LiteralPath $tmpPath -Destination $EnvPath -Force -ErrorAction Stop
}
catch {
  Remove-Item -LiteralPath $tmpPath -Force -ErrorAction SilentlyContinue
  Write-Fail "Move-Item atomico fallito. .env INTATTO. Errore: $($_.Exception.Message)"
}

Write-Ok ".env aggiornato con successo (atomico, backup preservato)."

# === 5. Pulizia memoria variabili contenenti plaintext ===
$newAnon       = $null
$newServiceKey = $null
$newLines      = $null
[GC]::Collect()
[GC]::WaitForPendingFinalizers()

# === 6. REPORT FINALE — ZERO VALORI ===
Write-Host ""
Write-Host "================================================"  -ForegroundColor Green
Write-Host "  ROTAZIONE COMPLETATA"                           -ForegroundColor Green
Write-Host "================================================"  -ForegroundColor Green
Write-Ok "Backup sicuro:    .backup/env/$Timestamp/.env"
Write-Ok "Variabili toccate: NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY"
Write-Ok "File .env:        aggiornato (encoding UTF-8 senza BOM)"
Write-Host ""
Write-Warn "=== AZIONI RICHIESTE ORA (ACTION_REQUIRED) ==="
Write-Warn " 1. Interrompi qualsiasi pnpm dev in esecuzione (CTRL+C)"
Write-Warn " 2. Ricarica il terminale oppure esegui: Remove-Item Env:NEXT_PUBLIC_SUPABASE_ANON_KEY, Env:SUPABASE_SERVICE_ROLE_KEY -ErrorAction SilentlyContinue"
Write-Warn " 3. Riavvia:  pnpm install  (solo se hai modificato package.json)"
Write-Warn " 4. Esegui:   pnpm typecheck  →  pnpm lint  →  pnpm build"
Write-Warn " 5. Verifica smoke: pnpm dev → apri /login → fai login funzionante"
Write-Warn " 6. Se il deploy è su Vercel: aggiorna Environment Variables dal pannello Vercel Project → Settings → Environment Variables"
Write-Warn "    (ANON key: tutti gli ambienti; SERVICE ROLE key: solo Production + Preview)"
Write-Warn " 7. RIPRISTINO EMERGENZA: Copy-Item '.backup/env/$Timestamp/.env' '.env' -Force"
Write-Host ""
Write-Warn "=== RIGUARDO JWT SIGNATURE (IMPORTANTE) ==="
Write-Warn " Se hai ruotato la 'JWT SECRET' (non solo API keys):"
Write-Warn "   → TUTTI i token in circolazione (sessioni utente attive) vengono invalidati."
Write-Warn "   → Ogni utente dovrà rifare il login. È il comportamento atteso e corretto."
Write-Warn "   → Elimina cookie browser 'sb-...-auth-token' se riscontri errori 401 dopo rotazione."
Write-Host ""
