# Underwater Mission Scenario Optimizer
La v0.33 apre l’atlante Terra/Mare. Per sviluppo locale usare `npm install` e `npm run dev`. La console precedente è disponibile su `console.html`. Il converter `tools/enc_to_geojson.py` prepara i sottolayer ENC.

I dati iniziali del Golfo della Spezia includono EMODnet Bathymetry (DTM e riferimenti sorgente 2024), GEBCO Bathymetric Compilation Group (2026), GEBCO_2026 Grid, e costa Natural Earth da QGIS. [EMODnet](https://emodnet.ec.europa.eu/en/bathymetry) · [GEBCO](https://www.gebco.net/data-products/gridded-bathymetry-data)

Lightweight browser prototype for underwater/maritime mission scenario composition and multi-objective decision support.

## Engineering rules

- Map interaction, AOI, external data adapters and optimizer logic are isolated modules.
- MapLibre is bundled at build time: no runtime CDN dependency for the map library.
- External service failures degrade only the affected data/layer; they must not crash the application.
- `REAL` environmental inputs are explicitly separated from `SURROGATE` predictors.
- Every change must pass core unit tests and critical browser regression tests before merge.

## Stack

- Vite
- MapLibre GL JS
- JavaScript ES modules
- Node test runner for pure/core logic
- Playwright for critical browser flows
- GitHub Actions + GitHub Pages

The first GitHub baseline is intentionally small. New features are added only after the regression gate remains green.
