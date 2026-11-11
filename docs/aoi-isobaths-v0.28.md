# v0.28 · Isobate numeriche AOI: contratto operatore

## Scelta di progetto
La **carta terrestre** e la **batimetria numerica** devono essere indipendenti.
Qualunque WMS GEBCO/EMODnet o GeoTIFF interpolato presentato senza una
maschera mare-terra validata può sovrapporsi a isole, costa e terraferma.

Per questa versione, la soluzione conservativa è **non renderizzare alcun
raster batimetrico colorato sulla carta operativa**. I raster WMS restano
registrati e selezionabili come *riferimenti di sorgente*, non come pixel da
sovrapporre alla terra. La base terrestre Minimal/Satellite resta immutata.
La maschera cartografica OpenFreeMap rimane indipendente dalla scelta
batimetrica.

Non è una soluzione di ritaglio raster sofisticata: è una restrizione
intenzionale della vista per evitare un'informazione grafica ingannevole.

## Isobate adattive da griglia AOI
- Si definisce AOI; il software tenta di ottenere la griglia batimetrica
  numerica WCS. Se non disponibile, una griglia di campioni REST può essere
  utilizzata come fallback con indicazione di qualità e copertura.
- L'operatore sceglie **N da 2 a 30 livelli**, con default 8.
- Gli N livelli sono distribuiti nell'intervallo osservato di profondità
  `(min, max)` a passo nominale `(max-min)/(N+1)`. Non includono gli
  estremi per evitare curve spurie sui margini del range, né livelli
  supplementari 2/5 m aggiunti di nascosto.
- Ogni livello genera curve SOLO in presenza di celle numeriche valide
  che attraversano la profondità. I nodata/terreno non vengono convertiti
  in profondità marine fittizie.
- Il risultato segnala **N richieste / M disponibili**; spesso M è inferiore.
  La qualità della sorgente, la risoluzione nativa, la copertura e i limiti
  di utilizzo restano espliciti.
- Il cambio di N riutilizza la griglia/campioni **già acquisiti e mantenuti
  in memoria**, senza riscaricare la batimetria.
- **Numero livelli** non è **numero di polilinee GeoJSON**: una stessa
  isobata di profondità può consistere in varie linee disgiunte.
- Il comando **Solo livelli principali** è un filtro grafico che può
  diminuire il numero di livelli visualizzati, senza alterare il
  parametro N o cancellare curve dal dato derivato.

## Esportazione e archivio esperimento
`Esporta isobate AOI (GeoJSON)` è abilitato solo quando il layer numerico
passa i gate di visualizzazione e contiene vere geometrie. Le curve sono
estratte entro la griglia AOI e sono corredate da:
- profondità in m, `major`, `shallow_priority`;
- sorgente, risoluzione nativa, derivazione, confidenza/coverage;
- nel GeoJSON esportato, metadati con AOI, N richieste, M disponibili,
  provenienza e cautela sul riuso fisico.

Al salvataggio di un esperimento con curve disponibili viene creato
`world-model/isobaths.geojson` nella cartella collegata. Il file
scompare dai prodotti generati se il nuovo snapshot non contiene più
curve valide, senza eliminare gli input raw dell'operatore.

## Restrizioni
- Nessuna isobata creata automaticamente da immagini WMS o da isobate
  WFS fuori area.
- Se nell'AOI mancano dati numerici adeguati, la carta mostra la mappa
  terrestre e lo stato **dati insufficienti**; non inventa la morfologia.
- I file derivati sono adatti a visualizzazione/analisi preliminare.
  Bellhop3D e i predittori usano il **grid numerico e i suoi metadati**,
  non il disegno delle curve come sostituto del fondo 3D.
- Il selettore GEBCO/EMODnet non scarica il DTM della sorgente scelta.
  La selezione effettiva della griglia numerica per la AOI rimane funzione
  del broker dati e del futuro Data Manager Python.
