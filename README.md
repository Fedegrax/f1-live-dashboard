# Pitwall Live

Dashboard F1 per qualsiasi Gran Premio e sessione (FP1, FP2, FP3, Sprint Quali, Sprint, Qualifiche, Gara).
Sito statico: nessun server da tenere acceso, i dati arrivano direttamente dal browser da [OpenF1](https://openf1.org).

## Cosa mostra

| Scheda | Contenuto |
|---|---|
| Classifica | Tower dei tempi: miglior giro, gap, ultimo giro, settori (viola/verde/giallo), gomma ed età, pit, velocità max, Q1/Q2/Q3, griglia. Clic su un pilota per tutti i suoi giri e mini-settori. |
| Giri & passo | Tempi sul giro per pilota, Δ vs best, distribuzione del passo, degrado gomme con pendenza s/giro. |
| Settori & velocità | Migliori settori, giro ideale, potenziale, speed trap e intermedi. |
| Strategia | Stint per mescola, uso gomme, pit stop. |
| Gara | Posizioni giro per giro, distacco dal leader, griglia vs arrivo (solo Sprint e Gara). |
| Telemetria | Confronto di due giri: mappa colorata per velocità/marcia/pedali/dominio, velocità, gas, freno, marcia, delta tempo. |
| Mappa & replay | Posizione di tutte le monoposto sul tracciato, replay con slider e velocità fino a 30×, modalità LIVE. |
| Direzione gara & meteo | Messaggi e bandiere, temperature, vento, umidità, team radio. |

Durante una sessione la pagina si aggiorna da sola (12 s). "Auto-live" passa da solo alla sessione in corso.
Lo stato (anno, GP, sessione, scheda) è nell'URL, quindi un link condiviso apre la stessa vista.

## Dati live

OpenF1 pubblica i dati **in diretta solo agli abbonati**. Senza account:

- i dati di una sessione sono liberi dopo la sua conclusione, la pagina li prende appena compaiono;
- durante la sessione compare un avviso e la pagina riprova ogni 30 secondi.

Con un account OpenF1 (menu **Account OpenF1**) tempi, posizioni e telemetria sono in tempo reale e i limiti di richieste salgono.
Le credenziali restano nel browser e vanno solo a `api.openf1.org`.

Senza account il client rispetta il limite gratuito (circa 27 richieste al minuto) con una coda interna.

## Pubblicazione 24/7 (GitHub Pages)

Il sito è tutto in `docs/`. Una sola volta:

1. Repository → **Settings → Pages**
2. **Source**: Deploy from a branch
3. **Branch**: il branch con questo codice, cartella **/docs**, poi Save

Indirizzo: `https://<utente>.github.io/f1-live-dashboard-/`

## Sviluppo

```sh
npm start        # http://localhost:8080
npm test         # test dei calcoli (tempi, classifiche, telemetria) su dati reali di FP1
npm run snapshot # aggiorna docs/data/calendar.json
```

`docs/data/calendar.json` è una copia del calendario usata se OpenF1 rifiuta le richieste non autenticate durante una diretta.

```
docs/
  index.html
  css/style.css
  js/api.js         client OpenF1: coda, limiti, login, cache IndexedDB
  js/data.js        calcoli puri (testati)
  js/app.js         selettori, caricamento, aggiornamento live
  js/views/*.js     una vista per scheda
  vendor/           Chart.js
test/               test e dati di esempio
```

Progetto non ufficiale, non affiliato a Formula 1.
