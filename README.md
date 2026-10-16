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

Da un terminale con Claude Code:

```
/plugin install utilizzo --marketplace matteoquattrini/claude_utilizzo
```

Rispondi `y` per aggiungere il marketplace, poi scegli l'ambito. Il mod è attivo subito.

Per provarlo da una cartella locale senza installarlo:

```
claude --plugin-dir <cartella-del-repository>
```
