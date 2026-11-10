# Gestione esperimenti (v0.27)

## Situazione prima del rilascio
La semplice selezione dell'AOI aggiornava lo stato della pagina, avviava un campionamento
batimetrico preliminare dove possibile e preparava *piani* di acquisizione.
Non esisteva ancora un repository permanente degli esperimenti. L'uso dei pulsanti
di download produceva file singoli nella destinazione configurata dal browser.

## Contratto di archiviazione
Il progetto introduce **due livelli di persistenza**:

1. **Catalogo locale IndexedDB**: `experiment.json` logico per ciascun progetto.
   Persistenza nel solo profilo/browser/origine web; può essere cancellata in
   modalità privata, eliminando i dati del sito o per politiche del browser.
2. **Cartella locale scelta esplicitamente** dall'operatore in Edge/Chromium su
   origine HTTPS tramite File System Access API. Il software crea una sottocartella
   con nome normalizzato più identificatore. La selezione cartella e la concessione
   dei permessi richiedono interazione diretta e potrebbero essere richieste di nuovo.
   Browser senza File System Access API: esporta/importa `experiment.json`.
   Questa esportazione contiene **solo JSON e metadati**, non grandi griglie binarie.

```text
Underwater-Experiments/
  catania-area-001-a1b2c3d4/
    experiment.json
    aoi.geojson
    inputs/
      raw/            # veri NetCDF, GeoTIFF, SVP, etc. allegati dall'operatore
      derived/        # per successivi predittori verificati
    world-model/
      environmental-request.json
      world-model-package.json
    acoustic/
      bellhop3d-environment.json
    runs/
    results/
```

## Processo per AOI ed ambiente
1. Crea un esperimento e collega la cartella desiderata (facoltativo, ma
   fortemente consigliato). Lo stato dell'archivio appare nella fascia inferiore.
2. Disegna AOI, imposta parametri, definisci periodo UTC e profondità.
   La batimetria visualizzata GEBCO/EMODnet è un **raster di contesto**.
3. Il software può campionare **nove punti batimetrici EMODnet** (quando
   disponibile) e recuperare un grid WCS nel browser tramite controller
   dedicato. **Il grid WCS risiede in memoria, non diventa automaticamente un
   GeoTIFF nel progetto**. La sua qualità/summary è registrabile nel manifesto.
4. Genera Environmental Request: piani source jobs Copernicus, EMODnet e
   GEBCO, con risoluzione, provenienza e gate di validazione. `SOURCE-RESOLVED`
   NON significa file acquisito. Le richieste Copernicus richiedono esecuzione
   presso un backend Python opportunamente configurato.
5. Genera inventario Bellhop3D e ricerca SVP in base alle candidate effettivamente
   importate. La presenza di un SVP salvato non certifica l'applicabilità a nuova
   AOI/time. Acoustic TL e portata rimangono **NOT RUN**.
6. Usa **Allega file reali** per conservare `*.nc`, `*.tif`, dati CTD/SVP ecc.
   nella sottocartella `inputs/raw`. Il manifesto cataloga i file come
   `UNVALIDATED_OPERATOR_INPUT` fino a una pipeline di QA.
7. Salva esperimento: salva snapshot nel browser, e nella cartella se collegata.
8. Riapri via lista locale, tramite **Apri cartella esperimento** oppure importa
   un manifest JSON. Su un altro computer è necessario copiare l'intera
   directory dei dati per recuperare anche i file raw.

## Distinzioni tassative

| Oggetto | Stato salvabile adesso | Limite |
|---|---|---|
| AOI | Coordinate e GeoJSON | Non sono rilievi ambientali |
| GEBCO/EMODnet WMS | Impostazione cartografica | Solo raster di contesto |
| EMODnet REST 3×3 | Campione/summary | Non è DTM di alta risoluzione |
| WCS grid in browser | Metadata/QA e summary | Il file binario non è allegato automaticamente |
| Copernicus T/S/SSH/onde | Manifest e job Python | Non equivale ad aver scaricato NetCDF |
| SVP importati | Campioni osservati in manifest | Da verificare per posizione, data, profondità |
| Bellhop3D | Piano input/gate | `NOT_RUN` e nessuna TL o detection range |
| File esterni allegati | Byte nel percorso `inputs/raw` | QA da eseguire prima dell'uso |

## Problemi da risolvere nella fase seguente
- Un **acquisition service** Python (local server/Workstation) che scarichi i
  veri file e li scriva automaticamente in `inputs/raw`, con hash, URL, licenza,
  data di accesso e intervallo di validità, senza dipendere dal browser.
- Un catalogo SQLite/PostGIS/GeoPackage se si vuole condividere dati tra
  più dispositivi o utenti; evitare di utilizzare IndexedDB come infrastruttura
  multi-operatore.
- Versione immutabile per ogni run: `runs/<run-id>/config.json`, riferimenti
  a dati con hash e `results/<run-id>/` per TL. Un esperimento può contenere più
  run con sensori, frequenze, SSP e condizioni differenti.
- Distinguere clone di configurazione da riuso di input: nessun nuovo run può
  dichiarare validati automaticamente file ereditati da un altro scenario.
- Persistenza dei dati numerici di griglia effettivamente acquisiti, non soltanto
  degli stati grafici e dei manifesti.

## Ricerca geografica
Il geocoder Photon di pubblico utilizzo restituiva HTTP 400 per la query che
conteneva `lang=it`. La versione v0.27 invia `q` e `limit` senza forzare la
lingua, con possibilità di inserire coordinate `latitudine, longitudine`.
La barra della ricerca può essere trascinata per il titolo. La posizione della
mappa cambia, mentre l'AOI resta invariata.

## Fonti tecniche
- https://github.com/komoot/photon/blob/master/docs/api-v1.md
- https://wiki.openstreetmap.org/wiki/Photon
- https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker
- https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API
