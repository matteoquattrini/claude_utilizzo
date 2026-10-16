# utilizzo

Un mod per Claude Code che mostra consumi e stato della sessione.

- **Banda sopra il prompt** su quattro righe: contesto (barra a sfumatura verde → rosso, token usati/totali), limiti dell'account 5h e 7 giorni con tempo al reset, costo e token della sessione, attività corrente e ultimo turno.
- **Pulsante Compatta** per compattare il contesto con un clic.
- **Avvisi** quando il contesto supera il 70%, l'85% e il 95%.
- **Pannello `/utilizzo`** con timeline dei tool (durata di ogni chiamata), ultimi turni e costi degli ultimi 7 giorni.

Note:

- Il costo in dollari è una stima a prezzo di listino API, non un addebito.
- I limiti 5h e 7 giorni compaiono solo con un abbonamento, dopo la prima risposta.
- Lo storico dei 7 giorni conta solo le sessioni in cui il mod è attivo (è salvato in locale).

## Installazione

Il comando `/plugin install` funziona solo in **Claude Code da terminale** (il comando `claude`), non nella scheda Code dell'app desktop. Una volta installato da terminale a livello utente, il mod si carica anche nelle sessioni locali dell'app desktop.

### 1. Installa Claude Code da terminale (se non lo hai già)

Da PowerShell, con l'installer ufficiale:

```
irm https://claude.ai/install.ps1 | iex
```

oppure con npm (serve Node.js):

```
npm install -g @anthropic-ai/claude-code
```

Chiudi e riapri il terminale. Al primo avvio ti chiede di accedere con il tuo account.

### 2. Avvia `claude`

Su Windows, in PowerShell, il comando `claude` può fallire con l'errore *"L'esecuzione di script è disabilitata nel sistema in uso"* (`PSSecurityException`), perché Windows blocca lo script `claude.ps1`. Due soluzioni:

- **Senza cambiare impostazioni:** avvia `claude.cmd` invece di `claude`, oppure usa il Prompt dei comandi (`cmd`), dove `claude` funziona normalmente.
- **Soluzione definitiva:** abilita gli script solo per il tuo utente (modifica un'impostazione di sicurezza di Windows, limitata al tuo utente):

  ```
  Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
  ```

### 3. Installa il mod

Nel prompt di Claude Code scrivi:

```
/plugin install utilizzo --marketplace matteoquattrini/claude_utilizzo
```

Rispondi `y` quando chiede di aggiungere il marketplace, poi scegli l'ambito (il primo è "utente"). Il mod è attivo subito.

### 4. Usalo

La banda compare da sola sopra il prompt. Per il pannello completo scrivi `/utilizzo` oppure premi **Dettagli** nella banda.

## Provarlo da una cartella locale

Senza installarlo, clonando questo repository:

```
claude --plugin-dir <cartella-del-repository>
```
