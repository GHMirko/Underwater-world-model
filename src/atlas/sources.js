const ceda =
  "https://dap.ceda.ac.uk/thredds/dodsC/bodc/gebco/global/gebco_2026/ice_surface_elevation/netcdf/GEBCO_2026.nc.ascii";

async function get(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(45000) });
  if (!response.ok)
    throw Error("Download fallito (HTTP " + response.status + ")");
  return response;
}

export async function areaResponse(path, wcsUrl) {
  const url = new URL(path, location.href);
  const [minLon, minLat, maxLon, maxLat] = url.searchParams
    .get("bbox")
    .split(",")
    .map(Number);
  if (
    !(
      minLon >= -180 &&
      maxLon <= 180 &&
      minLat >= -90 &&
      maxLat <= 90 &&
      minLon < maxLon &&
      minLat < maxLat
    )
  )
    throw Error("Area fuori estensione");
  if (url.pathname.endsWith("/emodnet")) {
    if ((maxLon - minLon) * (maxLat - minLat) * 960 ** 2 > 2400000)
      throw Error("Ridurre l’area EMODnet");
    return get(wcsUrl({ minLon, minLat, maxLon, maxLat }));
  }
  if (url.pathname.endsWith("/rilievi")) {
    const params = new URLSearchParams({
      service: "WFS",
      version: "1.0.0",
      request: "GetFeature",
      typeName: "emodnet:hr_bathymetry_area",
      bbox: [minLon, minLat, maxLon, maxLat].join(","),
      outputFormat: "application/json",
      maxFeatures: "100",
    });
    const catalog = await (
      await get("https://ows.emodnet-bathymetry.eu/wfs?" + params)
    ).json();
    return Response.json(catalog.features.map((f) => f.properties));
  }
  const x = Math.floor((minLon + 180) * 240),
    y = Math.floor((minLat + 90) * 240);
  const X = Math.ceil((maxLon + 180) * 240) - 1,
    Y = Math.ceil((maxLat + 90) * 240) - 1;
  const w = X - x + 1,
    h = Y - y + 1;
  if (w * h > 1200000) throw Error("Ridurre l’area GEBCO");
  const query = encodeURIComponent(
    "elevation[" + y + ":1:" + Y + "][" + x + ":1:" + X + "]",
  );
  const body = await (await get(ceda + "?" + query)).text();
  const rows = body
    .split("\n")
    .filter((line) => /^\[\d+\],/.test(line))
    .map((line) => line.split(",").slice(1).map(Number));
  if (
    rows.length !== h ||
    rows.some((row) => row.length !== w || row.some((v) => !Number.isFinite(v)))
  )
    throw Error("Griglia GEBCO incompleta");
  return Response.json({
    name: "GEBCO 2026",
    datum: "MSL nominale",
    sign: "up",
    type: "gebco",
    w,
    h,
    box: [x / 240 - 180, y / 240 - 90, (X + 1) / 240 - 180, (Y + 1) / 240 - 90],
    step: "15″",
    values: rows.reverse().flat(),
  });
}
