# VELORA — FASE 1 FREEZE: Esecuzione fuori sandbox

Esegui tutti i passaggi in un **PowerShell NORMALE fuori da TRAE** (non dentro l'IDE agent).

```powershell
cd C:\Users\david\Documents\trae_projects\VELORA
New-Item -ItemType Directory -Force out | Out-Null
```

---

## 0. Prerequisiti DA FARE PRIMA (se non già completi)

1. **Installa Docker Desktop**: https://www.docker.com/products/docker-desktop
2. **Riavvia** il PC se richiesto dall'installer.
3. Apri **Docker Desktop**, attendi che nel tray di Windows l'icona diventi **VERDE** (Engine RUNNING). Puoi saltare la creazione account.
4. Verifica in PowerShell (fuori TRAE) che risponda:
   ```powershell
   docker version
   docker info
   ```

---

## 1. Docker version + info (salva output)

```powershell
docker version  *> out\01_docker_version.txt
docker info     *> out\01_docker_info.txt
Get-Content out\01_docker_version.txt | Select-Object -First 12
```

## 2. Avvia Supabase locale (deve printare URL finali)

```powershell
pnpm db:start 2>&1 | Tee-Object -FilePath out\02_supabase_start.txt
```

- Attendi la stampa finale (**potrebbe impiegare 2-3 min** al primo avvio mentre scarica immagini).
- Alla fine devono comparire URL tipo:
  - `API URL: http://127.0.0.1:xxxx`
  - `DB URL: postgresql://...`
  - `Studio URL: http://127.0.0.1:yyyy`
- Se fallisce: copia errore e mandalo.

## 3. Primo reset (migrations 001-012 + seed)

```powershell
pnpm db:reset 2>&1 | Tee-Object -FilePath out\03_db_reset_1.txt
```

**Criterio successo**: tutte le migration applicate senza errori, seed.sql eseguito, exit code 0.

## 4. Primo run dei 43 test DB reali contro il locale

```powershell
pnpm db:test 2>&1 | Tee-Object -FilePath out\05_db_test_1.txt
```

**Atteso**: 43/43 PASS. Se anche 1 FAIL → fermati, riporta.

## 5. Secondo reset (idempotenza)

```powershell
pnpm db:reset 2>&1 | Tee-Object -FilePath out\06_db_reset_2.txt
```

## 6. Secondo run dei 43 test DB

```powershell
pnpm db:test 2>&1 | Tee-Object -FilePath out\07_db_test_2.txt
```

**Atteso**: 43/43 PASS. Idem come 4.

## 7. Types generation #1

```powershell
pnpm db:types
Copy-Item src/types/supabase.ts out\08_supabase_ts_gen1.ts -Force
Get-FileHash src/types/supabase.ts -Algorithm SHA256 | Out-File out\08_hash_gen1.txt
```

## 8. Types generation #2 (DETERMINISMO) — stesso schema, stesso file

```powershell
pnpm db:types
Copy-Item src/types/supabase.ts out\09_supabase_ts_gen2.ts -Force
Get-FileHash src/types/supabase.ts -Algorithm SHA256 | Out-File out\09_hash_gen2.txt

Write-Host "== HASH CONFRONTO (devono essere IDENTICI) =="
Get-Content out\08_hash_gen1.txt
Get-Content out\09_hash_gen2.txt
```

## 9. REMOTE: verifica READ-ONLY che test_* non esistano su cloud

Non eseguire DROP o modifiche. Solamente verifica.

**Metodo A (facile, via SQL Editor web)**

1. Apri https://supabase.com/dashboard/project/dgekfjkuvnofwdwxflms/sql/new
2. Esegui:
   ```sql
   SELECT proname FROM pg_proc WHERE proname LIKE 'test_%';
   ```
3. **Risultato atteso**: 0 righe.
4. Salva l'output screenshot/txt → `out\10_remote_testonly_verify.txt`

**Metodo B (CLI, se linkato prima)**

```powershell
# Esegui se hai già fatto pnpm db:link in passato
pnpm exec supabase inspect db functions --linked --project-id dgekfjkuvnofwdwxflms 2>&1 | Select-String "test_" | Out-File out\10_remote_testonly_verify.txt
# vuoto = OK
```

## 10. Quality gate finale (non distruttivo)

```powershell
pnpm check    2>&1 | Tee-Object -FilePath out\11_check.txt
pnpm test:e2e 2>&1 | Tee-Object -FilePath out\11_e2e.txt
```

## 11. Health endpoint (opzionale ma consigliato)

```powershell
# Terminale 1 (lascia running)
pnpm build ; pnpm start

# Terminale 2 (dopo 10s)
Start-Sleep 10
Invoke-RestMethod http://localhost:3000/api/health | ConvertTo-Json | Out-File out\11_health.json
# Stop del server nel terminale 1: Ctrl+C
```

---

## ⚠️ CONSEGNA A ME

Quando hai finito, condividi con me in un singolo messaggio TUTTI gli output seguenti (copia/incolla contenuto file TXT non vuoti):

- `out/01_docker_version.txt` (le prime 15 righe bastano)
- `out/02_supabase_start.txt` (solo URL finali e status healthy)
- `out/03_db_reset_1.txt` (solo riepilogo migration applicate + seed ok/fail)
- `out/05_db_test_1.txt` (SUMMARY: quanti PASS / FAIL, se FAIL quali)
- `out/06_db_reset_2.txt`
- `out/07_db_test_2.txt` (SUMMARY)
- HASH gen1 vs HASH gen2 (sono uguali? Sì/No e valori)
- `out/11_check.txt` (SUMMARY check, build)
- `out/11_e2e.txt` (SUMMARY 3/3?)
- Remote verify test_*: 0 righe? Sì/No.

Una volta ricevuti, io:

1. produco la Security Matrix definitiva EXPECTED/ACTUAL/PASS;
2. integro tutti i risultati reali nel report;
3. faccio `git stage + commit "test: prove reproducible multi-tenant database core"` (no push);
4. segno la FASE 1 **CONGELATA** se tutti i check sono verdi.
