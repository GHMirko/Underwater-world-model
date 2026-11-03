# Cartography coherence goals v0.11

- Basemap/land rendering is independent from bathymetry selection.
- Viewer bathymetry is a sea-only overlay; it must never replace or recolor land.
- EMODnet Atlas-with-land and GEBCO shaded relief are not exposed as viewer bathymetry modes because they include land/topography; they can still be used as data sources later.
- Isobaths follow the selected bathymetry source family:
  - Chart Relief (Seascape DEM) -> Seascape vector contours only.
  - EMODnet Rainbow / Multicolour -> EMODnet contours only.
  - None -> no contours.
- No silent mixing of bathymetry and contour sources.
- AOI completion automatically fits/zooms to the AOI; the manual Fit AOI control remains available.
