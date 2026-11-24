# v0.31 – ENC / Coastal Hydrography e ricostruzione batimetrica per Bellhop3D

## Risposta tecnica alla domanda

**Sì, una carta S-57 permette di derivare una superficie numerica del fondale,
ma è un problema inverso vincolato, non la semplice conversione di vettori
in raster.** Le informazioni rappresentate dalla carta hanno semantiche
differenti; trattarle tutte come punti di profondità sarebbe un errore.

| Oggetto | Significato | Uso nel modello |
|---|---|---|
| **SOUNDG** | Scandagli con profondità Z / DEPTH | Osservazioni batimetriche pubblicate in ENC, non necessariamente la totalità dei rilievi originari |
| **DEPCNT** | Isobata: profondità costante VALDCO | Vincolo di uguaglianza lungo la curva, campionato per la ricostruzione |
| **DEPARE** | Area con DRVAL1 / DRVAL2 | Intervallo ammissibile e maschera di dominio, **non punto numerico al valore medio** |
| **DRGARE** | Area dragata, intervallo di profondità | Vincolo d'intervallo, da verificare anche per epoca/maintenance |
| **M_QUAL / CATZOC** | Meta-oggetto sulla qualità idrografica | Provenienza e incertezza da verificare, **non sigma inventata** |
| **COALNE / UNSARE** | Costa / aree non rilevate | Contesto, maschere/esclusioni future; non sono profondità |
| **WRECKS / OBSTRN** | Relitti/ostacoli | Oggetti di vincolo e rischio, non valore di una cella DTM |

### Processo operativo nella versione

1. In **Dati → ENC / Coastal Hydrography**, selezionare AOI.
2. Acquisire le isobate Puglia via servizio ArcGIS REST oppure importare
   GeoJSON convertito da ENC S-57. Le carte **NOAA** ufficiali sono gratuite:
   https://charts.noaa.gov/ENCs/ENCs.shtml. Per i dataset **italiani** è
   necessario verificare i diritti sul prodotto; non è disponibile qui un
   collegamento automatico a ENC italiane ufficiali.
3. Se S-57, usare lo script GDAL in locale:
   ```bash
   python tools/enc_to_geojson.py /cartelle/US5xxxxx.000 \
     --output /cartelle/coastal-enc.geojson --bbox=-72.1,40.5,-72.0,40.6
   ```
   Richiede **ogr2ogr** (GDAL): `sudo apt install gdal-bin` oppure
   ambiente OSGeo4W/QGIS su Windows. Lasciare eventuali file `.001`,
   `.002` di aggiornamento accanto alla `.000`; il driver tenta
   `UPDATES=APPLY`. L'operatore deve verificare che la cella sia aggiornata.
4. Impostare passo della **griglia computazionale**, raggio massimo dei
   vincoli e *datum* noto da documentazione cartografica. Il campo datum
   annota l'informazione ma **non certifica** la conversione.
5. **Ricostruisci fondale PROVVISORIO per l'AOI**: il software campiona
   i vincoli SOUNDG/DEPCNT, impiega IDW locale a supporto limitato, evita
   di estrapolare oltre l'inviluppo convesso delle evidenze, usa DEPARE
   come dominio e verifica che le profondità rispettino gli intervalli.
   Ogni cella mantiene posizione, tipo di evidenza, distanza di supporto,
   CATZOC (se disponibile), motivo dell'eventuale assenza di dato.
6. Confrontare l'anteprima delle curve originarie (viola) con le isolinee
   derivate dalla superficie provvisoria (ocra). Il numero di isolinee
   d'anteprima segue il valore selezionato in **Carta → Numero isobate**.
7. Esportare **GeoJSON dei vincoli**, **JSON della griglia** e
   **CSV lon/lat/depth positivo verso il basso**. Nel documento esperimento
   la griglia è salvata come
   `world-model/coastal-chart-reconstruction.json`, mentre il dataset
   normalizzato è in `inputs/derived/coastal-hydrography.json`.
   La S-57 originale resta un dato *raw*: va allegata al progetto con
   **Missione → Esperimenti → Allega file reali**.
8. Il manifest World Model e l'inventario Bellhop3D ricevono il modello
   **come candidato ricostruito con stato BLOCCATO**. Non viene dichiarata
   una simulazione eseguita né una TL disponibile.

### Perché non generiamo subito un file Bellhop3D certificabile

Una superficie idonea a Bellhop3D deve coprire **l'intero dominio sorgente –
ricevitori e i percorsi acustici**, non solo l'AOI rettangolare; richiede
batimetria coerente con coordinate metriche, datum verticale e livello del
mare, condizioni al contorno geoacustiche, e validazione morfologica.

Una ENC contiene oggetti cartografici *generalizzati per scala di
compilazione*. La densità delle isobate non equivale alla densità del
multibeam; una griglia calcolata ogni 5 m da curve a distanza di centinaia
di metri **non ha risoluzione informativa di 5 m**. In particolare:

- L'IDW iniziale è un **prototipo di superficie vincolata**, non garantisce
  di onorare esattamente le curve tra i nodi o la conservazione dei minimi,
  massimi e discontinuità morfologiche.
- Una cella resta `nodata` se non è sufficientemente supportata. Un
  tratto non rilevato non diventa automaticamente fondo marino continuo.
- Se il datum è ignoto o non riconciliato, l'input resta in `NOT_READY`.
- La qualità CATZOC va ricondotta all'edizione e al rilievo effettivo,
  valutando offset, scale, incertezza orizzontale/verticale e data.
- Per un uso acustico quantitativo servono **validazione indipendente**
  contro DTM/MBES, test di ricampionamento, sensitivity ensemble e
  verifica del fondo lungo i tragitti. Una superficie da sole isobate
  può essere una buona baseline di sensitivity analysis, non una
  previsione automaticamente validata.

**Fase successiva raccomandata**: data manager Python che fonda un DTM
HR affidabile con gli oggetti S-57 come vincoli/cross-check;
interpolazione che onori esattamente isobate e sounding con residui,
maschera land–water robusta, datum converter e un vero esportatore
Bellhop3D `.bty` solo dopo superamento dei gate.

## Origine Puglia

Servizio pubblico verificato:
https://webapps.sit.puglia.it/arcgis/rest/services/ServicesArcIMS/batimetria/MapServer/0

- Layer 0 `BATIMETRIA`, geometria `esriGeometryPolyline`;
- campo `Z` con valori **negativi** (es. `-5`, `-10`, `-25`) per le
  isobate; convertiti in profondità positiva verso il basso;
- servizio in CRS EPSG:32633 ma query eseguita con
  `inSR=4326` e `outSR=4326`;
- catalogazione regionale, **non** ENC S-57, non griglia DTM;
- il servizio browser può essere soggetto a **CORS**, disponibilità e
  limiti di richieste. L'app non presenta una ricerca fallita come
  acquisizione riuscita. Verificare i termini di licenza prima del riuso.

## Architettura implementata

- `tools/enc_to_geojson.py`: parser GDAL di classi S-57 a oggetti.
- `src/data/coastal-hydrography.js`: semantica e normalizzazione.
- `src/data/puglia-coastal-source.js`: query ArcGIS AOI con paginazione ID.
- `src/data/chart-constrained-surface.js`: superficie IDW conservativa.
- `src/ui/coastal-hydrography-controller.js`: pannello operatore e
  visualizzazione vettoriale senza alterare terra/sea background.
- `src/experiments/experiment-store.js`: persistenza esperimenti.
- `src/data/world-model-package.js`: traccia modello derivato con QA.
- `src/data/bellhop3d-environment.js`: candidato input ma NON READY.

## Riferimenti ufficiali
- IHO S-57 via GDAL: https://gdal.org/en/stable/drivers/vector/s57.html
- NOAA ENC / ENC Direct: https://nauticalcharts.noaa.gov/learn/encdirect/
- Puglia BATIMETRIA layer: https://webapps.sit.puglia.it/arcgis/rest/services/ServicesArcIMS/batimetria/MapServer/0
- EMODnet DTM: https://emodnet.ec.europa.eu/en/bathymetry
