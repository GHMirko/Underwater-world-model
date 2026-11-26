import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./style.css";
import * as turf from "@turf/turf";
import { fromArrayBuffer } from "geotiff";
import { buildEmodnetWcsUrl } from "../data/emodnet-wcs.js";
import { areaResponse } from "./sources.js";
const $ = (id) => document.getElementById(id);
const map = L.map("map", {
  preferCanvas: true,
  zoomControl: true,
  maxZoom: 20,
  zoomSnap: 0.25,
}).setView([44.047, 9.86], 11.5);
L.control.scale({ imperial: false }).addTo(map);
map.createPane("costa");
map.getPane("costa").style.zIndex = 180;
const base = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxNativeZoom: 19,
  maxZoom: 20,
  attribution: "© OpenStreetMap contributors",
});
const credits = "EMODnet Bathymetry · GEBCO Compilation Group 2026";
map.attributionControl.addAttribution(credits);
const marine = L.layerGroup().addTo(map),
  charts = L.layerGroup().addTo(marine),
  outline = L.layerGroup().addTo(marine);
let grids = [],
  cells = [],
  land = null,
  mode = "mare",
  aoi = null,
  first = null,
  drawing = false,
  exclusions = [],
  frame = 0,
  levelList = [],
  nextId = 0;
const categories = {
  access: "Ingresso vietato",
  anchorBan: "Ancoraggio vietato",
  other: "Altre restrizioni",
  anchorage: "Ancoraggi",
  wreck: "Relitti",
  danger: "Rocce e ostruzioni",
  depth: "Batimetria ENC",
  quality: "Qualità del rilievo",
};
const colors = {
  access: "#a32b42",
  anchorBan: "#a65229",
  other: "#aa6f30",
  anchorage: "#31639a",
  wreck: "#722c73",
  danger: "#b94b12",
  depth: "#526784",
  quality: "#6d716e",
};
const controls = {};
$("layers").innerHTML = "<b>Sottolayer</b><b>Mostra</b><b>Escludi</b>";
for (const [key, label] of Object.entries(categories)) {
  const title = document.createElement("span");
  title.textContent = label;
  $("layers").append(title);
  controls[key] = {};
  for (const action of ["show", "exclude"]) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.setAttribute(
      "aria-label",
      (action === "show" ? "Mostra " : "Escludi ") + label,
    );
    box.checked = action === "show" && key !== "quality";
    box.disabled = action === "exclude" && ["quality", "depth"].includes(key);
    box.onchange = () => {
      vectors();
      schedule();
    };
    controls[key][action] = box;
    $("layers").append(box);
  }
}
function classify(f) {
  const p = f.properties,
    c = p.code,
    cats = [],
    r = String(p.RESTRN || "").match(/\d+/g) || [];
  if (r.includes("7")) cats.push("access");
  if (r.includes("1")) cats.push("anchorBan");
  if (r.some((n) => !["7", "1"].includes(n)) || (c === "RESARE" && !r.length))
    cats.push("other");
  const k = {
    ACHARE: "anchorage",
    ACHBRT: "anchorage",
    WRECKS: "wreck",
    UWTROC: "danger",
    OBSTRN: "danger",
    SOUNDG: "depth",
    DEPCNT: "depth",
    DEPARE: "depth",
    M_QUAL: "quality",
  }[c];
  if (k) cats.push(k);
  return cats;
}
function inside(x, y, b) {
  return x >= b[0] && x < b[2] && y > b[1] && y <= b[3];
}
function bounds() {
  const b = map.getBounds();
  return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
}
function overlap(a, b) {
  return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
}
function encText(f) {
  const p = f.properties;
  return [
    p.code,
    p.OBJNAM,
    p.cell,
    ...[
      "RESTRN",
      "VALSOU",
      "VALDCO",
      "DRVAL1",
      "DRVAL2",
      "DEPTH",
      "DATSTA",
      "DATEND",
      "PERSTA",
      "PEREND",
      "INFORM",
    ]
      .filter((k) => p[k] != null)
      .map((k) => k + " " + p[k]),
  ]
    .filter(Boolean)
    .join(" · ");
}
function vectors() {
  charts.clearLayers();
  outline.clearLayers();
  exclusions = [];
  let skipped = 0;
  const radius = Math.max(0, Number($("radius").value) || 0);
  const box = aoi || bounds(),
    region = turf.bboxPolygon(box);
  for (const cell of cells)
    for (const f of cell.features) {
      if (!f.geometry) continue;
      const cats = classify(f),
        k = cats.find((k) => controls[k].show.checked);
      if (k) {
        const style = { color: colors[k], weight: 1.5, fillOpacity: 0.09 };
        const layer = L.geoJSON(f, {
          style: { ...style, bubblingMouseEvents: false },
          bubblingMouseEvents: false,
          pointToLayer: (_, p) =>
            L.circleMarker(p, {
              ...style,
              bubblingMouseEvents: false,
              radius: 4,
              fillOpacity: 0.8,
            }),
        }).addTo(charts);
        layer.on("click", (ev) => {
          L.DomEvent.stopPropagation(ev);
          if (drawing) {
            mapClick(ev.latlng);
            return;
          }
          inspect(ev.latlng, encText(f));
          const grid = best(ordered(), ev.latlng.lng, ev.latlng.lat),
            p = f.properties;
          if (k === "depth" && grid && grid.v >= 0) {
            const z =
              p.DEPTH ??
              p.VALDCO ??
              (p.code === "SOUNDG" ? f.geometry.coordinates[2] : undefined);
            const same =
              cell.datum === grid.g.datum && cell.datum !== "Sconosciuto";
            if (z != null && Number.isFinite(+z))
              $("inspect").append(
                " | ENC " +
                  fmt(+z) +
                  " m" +
                  (same
                    ? " · Δ ENC − griglia " + fmt(+z - grid.v) + " m"
                    : " · datum ENC da confrontare"),
              );
            if (p.DRVAL1 != null && p.DRVAL2 != null && same)
              $("inspect").append(
                grid.v >= +p.DRVAL1 && grid.v <= +p.DRVAL2
                  ? " | Quota entro la fascia ENC"
                  : " | Quota fuori fascia ENC",
              );
          }
          if (aoi && cats.some((c) => !controls[c].exclude.disabled)) {
            const btn = document.createElement("button");
            btn.textContent =
              " " +
              (f.override === "exclude"
                ? "Includi questo oggetto"
                : "Escludi questo oggetto");
            btn.onclick = () => {
              f.override = f.override === "exclude" ? "include" : "exclude";
              vectors();
              schedule();
              $("inspect").textContent = encText(f) + " · scelta aggiornata.";
            };
            $("inspect").append(" ", btn);
          }
        });
      }
      if (
        !aoi ||
        f.override === "include" ||
        (f.override !== "exclude" &&
          !cats.some((k) => controls[k].exclude.checked))
      )
        continue;
      const p = f.properties;
      // Temporal restrictions need an operator decision in the chart; avoid silently applying historical rules.
      if (
        (p.DATSTA || p.DATEND || p.PERSTA || p.PEREND) &&
        f.override !== "exclude"
      ) {
        skipped++;
        continue;
      }
      const poly = /Polygon/.test(f.geometry.type)
        ? f
        : radius
          ? turf.buffer(f, radius, { units: "meters" })
          : null;
      if (!poly) {
        skipped++;
        continue;
      }
      const cut = turf.intersect(turf.featureCollection([region, poly]));
      if (cut) {
        exclusions.push({ f: cut, b: turf.bbox(cut) });
        L.geoJSON(cut, {
          interactive: false,
          style: { color: "#b74545", weight: 1, fillOpacity: 0.27 },
        }).addTo(outline);
      }
    }
  if (aoi)
    L.rectangle(
      [
        [aoi[1], aoi[0]],
        [aoi[3], aoi[2]],
      ],
      {
        interactive: false,
        color: "#e18e12",
        fill: false,
        weight: 2,
        dashArray: "7 4",
      },
    ).addTo(outline);
  $("extent").textContent = drawing
    ? first
      ? "Seleziona il secondo angolo."
      : "Seleziona il primo angolo."
    : (aoi
        ? "AOI fissata · " + exclusions.length + " geometrie escluse."
        : "Isobate adattate alla vista corrente.") +
      (skipped
        ? " " + skipped + " elementi da verificare (validità o raggio)."
        : "");
  let intersecting = 0;
  for (const cell of cells)
    if (
      cell.features.some(
        (f) =>
          f.properties.code === "M_COVR" &&
          Number(f.properties.CATCOV) === 1 &&
          turf.booleanIntersects(region, f),
      )
    )
      intersecting++;
  $("chartState").textContent = cells.length
    ? cells.length +
      " celle importate · " +
      intersecting +
      " con copertura cartografata che interseca " +
      (aoi ? "l’AOI." : "la vista.")
    : "Nessuna cella ENC caricata · copertura tematica sconosciuta.";
}
function excluded(x, y) {
  return exclusions.some(
    (o) => inside(x, y, o.b) && turf.booleanPointInPolygon([x, y], o.f),
  );
}
function sample(g, x, y) {
  if (!inside(x, y, g.box)) return null;
  const col = Math.floor((x - g.box[0]) / g.dx),
    row = Math.floor((g.box[3] - y) / g.dy);
  const raw = g.values[row * g.w + col];
  if (
    raw == null ||
    Math.abs(raw) > 100000 ||
    !Number.isFinite(raw) ||
    raw === g.noData
  )
    return null;
  return g.sign === "up" ? -raw : raw;
}
function interpolated(g, x, y, fallback) {
  const u = (x - g.box[0]) / g.dx - 0.5,
    v = (g.box[3] - y) / g.dy - 0.5;
  const i = Math.floor(u),
    j = Math.floor(v);
  if (i < 0 || j < 0 || i + 1 >= g.w || j + 1 >= g.h) return fallback;
  const k = j * g.w + i,
    raw = [
      g.values[k],
      g.values[k + 1],
      g.values[k + g.w],
      g.values[k + g.w + 1],
    ];
  if (
    raw.some(
      (a) =>
        a == null ||
        Math.abs(a) > 100000 ||
        !Number.isFinite(a) ||
        a === g.noData ||
        (g.sign === "up" ? a > 0 : a < 0),
    )
  )
    return fallback;
  const a = u - i,
    b = v - j,
    depth =
      (1 - b) * ((1 - a) * raw[0] + a * raw[1]) +
      b * ((1 - a) * raw[2] + a * raw[3]);
  return g.sign === "up" ? -depth : depth;
}
function ordered() {
  const selected = $("source").value;
  return selected === "auto"
    ? grids
        .filter((g) => g.datum !== "Sconosciuto")
        .sort((a, b) => a.dx * a.dy - b.dx * b.dy || b.id - a.id)
    : grids.filter((g) => String(g.id) === selected);
}
function lineage(g, x, y) {
  if (!g.origin || !inside(x, y, g.box)) return "";
  const col = Math.floor((x - g.box[0]) / g.dx),
    row = Math.floor((g.box[3] - y) / g.dy);
  return g.origin.names[g.origin.pixels[row * g.w + col]] || "";
}
function best(gs, x, y) {
  let inherited = null;
  for (const g of gs) {
    const v = sample(g, x, y);
    if (v === null) continue;
    if (g.origin && lineage(g, x, y).toUpperCase().startsWith("GEBCO")) {
      inherited ??= { v, g };
      continue;
    }
    if (inherited && g.type !== "gebco" && g.dx * g.dy > STEP_GEBCO ** 2)
      continue;
    return { v, g };
  }
  return inherited;
}
const STEP_GEBCO = 1 / 240;
function addGrid(g) {
  if (
    g.w < 1 ||
    g.h < 1 ||
    g.values.length !== g.w * g.h ||
    !g.box.every(Number.isFinite)
  )
    throw Error("Griglia non valida");
  g.dx = (g.box[2] - g.box[0]) / g.w;
  g.dy = (g.box[3] - g.box[1]) / g.h;
  g.id = nextId++;
  grids.push(g);
  const op = new Option(g.name, g.id);
  $("source").add(op);
}
async function tif(buffer, meta) {
  const t = await fromArrayBuffer(buffer),
    im = await t.getImage(),
    keys = im.getGeoKeys();
  const matrix = im.getFileDirectory().getValue("ModelTransformation");
  if (
    keys.GeographicTypeGeoKey !== 4326 ||
    keys.ProjectedCSTypeGeoKey ||
    (matrix && (matrix[1] || matrix[4]))
  )
    throw Error(
      "Serve GeoTIFF geografico EPSG:4326, nord in alto e senza rotazione.",
    );
  if (im.getWidth() * im.getHeight() > 12000000)
    throw Error("Ritagliare il rilievo in tile fino a 12 milioni di celle.");
  const [rx, ry] = matrix ? [matrix[0], matrix[5]] : im.getResolution();
  if (rx <= 0 || ry >= 0)
    throw Error("Orientamento del raster non supportato.");
  return {
    ...meta,
    w: im.getWidth(),
    h: im.getHeight(),
    box: im.getBoundingBox(),
    values: (await im.readRasters({ samples: [0] }))[0],
    noData: im.getGDALNoData(),
  };
}
function windowIndices(g, b) {
  return [
    Math.max(0, Math.floor((b[0] - g.box[0]) / g.dx)),
    Math.max(0, Math.floor((g.box[3] - b[3]) / g.dy)),
    Math.min(g.w, Math.ceil((b[2] - g.box[0]) / g.dx)),
    Math.min(g.h, Math.ceil((g.box[3] - b[1]) / g.dy)),
  ];
}
function limits(gs, b) {
  let lo = Infinity,
    hi = -Infinity;
  for (const g of gs.filter((g) => overlap(g.box, b))) {
    const [l, t, r, bt] = windowIndices(g, b);
    for (let j = t; j < bt; j++)
      for (let i = l; i < r; i++) {
        // Include cell footprints even when zoom is inside one pixel.
        const x = Math.max(b[0], g.box[0] + i * g.dx),
          X = Math.min(b[2], g.box[0] + (i + 1) * g.dx);
        const y = Math.max(b[1], g.box[3] - (j + 1) * g.dy),
          Y = Math.min(b[3], g.box[3] - j * g.dy);
        const xx = (x + X) / 2,
          yy = (y + Y) / 2,
          p = best(gs, xx, yy);
        if (p && p.g === g && p.v >= 0 && !excluded(xx, yy)) {
          lo = Math.min(lo, p.v);
          hi = Math.max(hi, p.v);
        }
      }
  }
  return [lo, hi];
}
const canvas = document.createElement("canvas");
canvas.style.cssText = "position:absolute;pointer-events:none";
map.getPane("overlayPane").prepend(canvas);
const fmt = (v) =>
  Number(v.toFixed(2)).toLocaleString("it-IT", { maximumFractionDigits: 2 });
function schedule() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(render);
}
function render() {
  canvas.style.display = mode === "mare" ? "block" : "none";
  if (mode !== "mare") return;
  const size = map.getSize(),
    origin = map.containerPointToLayerPoint([0, 0]);
  L.DomUtil.setPosition(canvas, origin);
  canvas.width = size.x;
  canvas.height = size.y;
  const ctx = canvas.getContext("2d"),
    b = bounds(),
    gs = ordered(),
    zone = aoi || b;
  const [lo, hi] = limits(gs, zone),
    n = Math.min(40, Math.max(0, Math.floor(+$("count").value) || 0));
  levelList =
    Number.isFinite(lo) && hi > lo
      ? Array.from(
          { length: n },
          (_, i) => lo + ((hi - lo) * (i + 1)) / (n + 1),
        )
      : [];
  $("range").textContent = Number.isFinite(lo)
    ? "Profondità " + fmt(lo) + " – " + fmt(hi) + " m"
    : "Nessuna profondità valida nell’area.";
  $("levels").textContent = levelList.length
    ? "Quote (m) · " + levelList.map(fmt).join(" · ")
    : "";
  // Precompute map projection and winners on the display grid. Same-source triangles avoid gradients across datums or missing cells.
  const pitch = 2,
    W = Math.ceil(size.x / pitch) + 1,
    H = Math.ceil(size.y / pitch) + 1;
  const xs = Array.from(
    { length: W },
    (_, i) => map.containerPointToLatLng([i * pitch, 0]).lng,
  );
  const ys = Array.from(
    { length: H },
    (_, j) => map.containerPointToLatLng([0, j * pitch]).lat,
  );
  const vals = new Float32Array(W * H).fill(NaN),
    ids = new Int32Array(W * H).fill(-1);
  const tmp = document.createElement("canvas");
  tmp.width = W;
  tmp.height = H;
  const tc = tmp.getContext("2d"),
    im = tc.createImageData(W, H);
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const x = xs[i],
        y = ys[j],
        p = best(gs, x, y),
        k = j * W + i;
      if (!p) continue;
      const col = k * 4;
      if (p.v < 0) {
        im.data.set([231, 231, 212, 255], col);
        continue;
      }
      const z = Math.max(
        0,
        Math.min(
          1,
          Math.log1p(p.v) /
            Math.log1p(Math.max(30, Number.isFinite(hi) ? hi : 100)),
        ),
      );
      im.data.set([185 - 158 * z, 235 - 139 * z, 224 - 99 * z, 255], col);
      if ((!aoi || inside(x, y, aoi)) && !excluded(x, y)) {
        vals[k] = interpolated(p.g, x, y, p.v);
        ids[k] = p.g.id;
      }
    }
  tc.putImageData(im, 0, 0);
  if ($("surface").checked) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tmp, 0, 0, W * pitch, H * pitch);
  }
  ctx.strokeStyle = "#f3fff8";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let j = 0; j < H - 1; j++)
    for (let i = 0; i < W - 1; i++) {
      const k = j * W + i;
      for (const pair of [
        [k, k + 1, k + W + 1],
        [k, k + W + 1, k + W],
      ]) {
        const [a, c, d] = pair;
        if (ids[a] < 0 || ids[a] !== ids[c] || ids[a] !== ids[d]) continue;
        const low = Math.min(vals[a], vals[c], vals[d]),
          high = Math.max(vals[a], vals[c], vals[d]);
        if (low === high) continue;
        for (const v of levelList) {
          if (v < low || v >= high) continue;
          let start = true;
          for (let h = 0; h < 3; h++) {
            const u = pair[h],
              w = pair[(h + 1) % 3];
            if (vals[u] > v === vals[w] > v) continue;
            const t = (v - vals[u]) / (vals[w] - vals[u]),
              x = ((1 - t) * (u % W) + t * (w % W)) * pitch,
              y = ((1 - t) * Math.floor(u / W) + t * Math.floor(w / W)) * pitch;
            if (start) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
            start = false;
          }
        }
      }
    }
  ctx.stroke();
}
function inspect(ll, extra = "") {
  const x = ll.lng,
    y = ll.lat,
    s = best(ordered(), x, y),
    all = grids
      .map((g) => ({ g, v: sample(g, x, y) }))
      .filter((o) => o.v !== null && o.v >= 0);
  const lines = [ll.lat.toFixed(5) + "°, " + ll.lng.toFixed(5) + "°", extra];
  if (s && s.v >= 0) {
    lines.push(
      fmt(s.v) +
        " m · " +
        s.g.name +
        (lineage(s.g, x, y) ? " / " + lineage(s.g, x, y) : "") +
        " · " +
        s.g.datum +
        " · passo " +
        (s.g.step || fmt(s.g.dy * 111195) + " m N–S"),
    );
    for (const p of all.filter((p) => p.g !== s.g)) {
      let cmp =
        p.g.datum === s.g.datum && p.g.datum !== "Sconosciuto"
          ? " · Δ " + fmt(p.v - s.v) + " m"
          : " · riferimenti verticali da verificare";
      lines.push(p.g.name + " " + fmt(p.v) + " m" + cmp);
    }
  } else lines.push(s ? "Terra" : "Copertura batimetrica assente");
  if (excluded(x, y)) lines.push("Escluso dall’AOI");
  $("inspect").textContent = lines.filter(Boolean).join(" | ");
}
function mapClick(ll) {
  if (mode !== "mare") return;
  if (!drawing) {
    inspect(ll);
    return;
  }
  if (!first) {
    first = ll;
    vectors();
    return;
  }
  const b = [
    Math.min(first.lng, ll.lng),
    Math.min(first.lat, ll.lat),
    Math.max(first.lng, ll.lng),
    Math.max(first.lat, ll.lat),
  ];
  if (b[0] === b[2] || b[1] === b[3]) return;
  aoi = b;
  endDraw();
  vectors();
  schedule();
}
function endDraw() {
  drawing = false;
  first = null;
  $("draw").classList.remove("active");
}
$("draw").onclick = () => {
  if (drawing) endDraw();
  else {
    drawing = true;
    first = null;
    $("draw").classList.add("active");
  }
  vectors();
};
$("clear").onclick = () => {
  endDraw();
  aoi = null;
  vectors();
  schedule();
};
map.on("click", (e) => mapClick(e.latlng));
map.on("moveend resize", () => {
  vectors();
  schedule();
});
map.on("zoomstart", () => {
  canvas.style.visibility = "hidden";
});
map.on("zoomend", () => {
  canvas.style.visibility = "visible";
  schedule();
});
$("radius").onchange = () => {
  vectors();
  schedule();
};
$("count").oninput = schedule;
$("surface").onchange = schedule;
$("source").onchange = schedule;
function view(name) {
  mode = name;
  endDraw();
  const sea = name === "mare";
  $("marine").hidden = !sea;
  $("landInfo").hidden = sea;
  $("mare").classList.toggle("selected", sea);
  $("terra").classList.toggle("selected", !sea);
  if (sea) {
    base.remove();
    if (land) land.addTo(map);
    marine.addTo(map);
    map.attributionControl.addAttribution(credits);
  } else {
    marine.remove();
    base.addTo(map);
    map.attributionControl.removeAttribution(credits);
  }
  $("inspect").textContent = sea
    ? "Seleziona un punto per leggere i dati."
    : "Carta terrestre · © OpenStreetMap contributors";
  schedule();
}
$("mare").onclick = () => view("mare");
$("terra").onclick = () => view("terra");
const emMeta = {
  name: "EMODnet DTM · composito",
  datum: "LAT",
  step: "3,75″",
  sign: "up",
  type: "emodnet",
};
function loadCell(fc) {
  if (Array.isArray(fc.features))
    for (const f of fc.features) {
      const p = f.properties;
      if (p) {
        p.code ??= p._s57_layer;
        p.cell ??= p._source_cell;
      }
    }
  fc.name ??= fc.features?.[0]?.properties?.cell;
  if (
    fc.type !== "FeatureCollection" ||
    !Array.isArray(fc.features) ||
    !fc.features.some((f) => f.properties?.code)
  )
    throw Error("Serve una cella convertita con tools/enc_to_geojson.py.");
  cells = cells.filter((c) => c.name !== fc.name);
  cells.push(fc);
}
function archive() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("terra-mare-v1", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("files");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function saveEntry(key, entry) {
  const db = await archive();
  try {
    await new Promise((resolve, reject) => {
      const t = db.transaction("files", "readwrite");
      t.objectStore("files").put(entry, key);
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}
function mount(entry) {
  if (entry.kind === "enc") {
    loadCell(entry.data);
    return;
  }
  const g = entry.data;
  const index = grids.findIndex(
    (o) =>
      o.name === g.name && o.box.every((v, i) => Math.abs(v - g.box[i]) < 1e-9),
  );
  if (index !== -1) {
    const old = grids[index];
    $("source")
      .querySelector('option[value="' + old.id + '"]')
      ?.remove();
    grids.splice(index, 1);
  }
  addGrid(g);
}
$("upload").onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    let entry;
    if (/\.tiff?$/i.test(f.name)) {
      const name = $("survey").value.trim() || f.name;
      const data = await tif(await f.arrayBuffer(), {
        name,
        datum: $("datum").value,
        sign: $("sign").value,
        date: $("surveyDate").value,
        uncertainty: $("sigma").value,
        type: "local",
      });
      entry = { kind: "grid", data };
    } else {
      entry = { kind: "enc", data: JSON.parse(await f.text()) };
      entry.data.datum = $("datum").value;
    }
    mount(entry);
    vectors();
    schedule();
    await saveEntry("import:" + f.name, entry);
    $("importState").textContent = "Importato e salvato · " + f.name;
  } catch (err) {
    $("importState").textContent = err.message;
  } finally {
    e.target.value = "";
  }
};
async function request(path) {
  if (path.startsWith("area/")) return areaResponse(path, buildEmodnetWcsUrl);
  if (path.startsWith("dati/")) {
    const response = await fetch(
      import.meta.env.BASE_URL + "atlas/" + path.slice(5) + ".gz",
    );
    if (!response.ok) throw Error("Dati iniziali indisponibili");
    const bytes = await response.arrayBuffer();
    if (new Uint8Array(bytes)[0] !== 31) return new Response(bytes);
    return new Response(
      new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")),
    );
  }
  const r = await fetch(path);
  if (!r.ok)
    throw Error(
      "Servizio indisponibile o area troppo estesa (" + r.status + ").",
    );
  return r;
}
$("download").onclick = async () => {
  const button = $("download"),
    b = aoi || bounds(),
    q = "?bbox=" + b.map((v) => v.toFixed(6)).join(",");
  button.disabled = true;
  $("network").textContent = "Download in corso…";
  const msg = await Promise.all(
    ["gebco", "emodnet", "rilievi"].map(async (key) => {
      try {
        const r = await request("area/" + key + q);
        if (key === "rilievi") {
          const rows = await r.json();
          const label = rows
            .slice(0, 8)
            .map((row) =>
              Object.values(row).find(
                (s) =>
                  typeof s === "string" &&
                  s.length > 14 &&
                  !s.startsWith("http"),
              ),
            )
            .filter(Boolean);
          return (
            "Rilievi HR nel catalogo: " +
            rows.length +
            (label.length ? " · " + label.join(", ") : "")
          );
        }
        const g =
          key === "gebco"
            ? await r.json()
            : await tif(await r.arrayBuffer(), emMeta);
        const entry = { kind: "grid", data: g };
        mount(entry);
        schedule();
        await saveEntry(key + q, entry);
        return key + " acquisito";
      } catch (err) {
        return key + " · " + err.message;
      }
    }),
  );
  $("network").textContent = msg.join(" | ");
  button.disabled = false;
};
async function start() {
  const results = await Promise.allSettled([
    request("dati/gebco.json")
      .then((r) => r.json())
      .then(addGrid),
    Promise.all([
      request("dati/emodnet.tif")
        .then((r) => r.arrayBuffer())
        .then((b) => tif(b, emMeta)),
      request("dati/origini.json").then((r) => r.json()),
    ]).then(([g, o]) => {
      g.origin = {
        names: o.names,
        pixels: Uint8Array.from(atob(o.pixels), (c) => c.charCodeAt(0)),
      };
      addGrid(g);
    }),
    request("dati/costa.json")
      .then((r) => r.json())
      .then((fc) => {
        land = L.geoJSON(fc, {
          interactive: false,
          pane: "costa",
          style: { stroke: false, fillColor: "#e8e9d7", fillOpacity: 0.85 },
        });
        land.addTo(map);
        land.bringToBack();
      }),
  ]);
  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length)
    $("network").textContent = failed.map((r) => r.reason.message).join(" · ");
  try {
    const db = await archive(),
      entries = await new Promise((res, rej) => {
        const r = db.transaction("files").objectStore("files").getAll();
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    db.close();
    entries.forEach(mount);
  } catch (err) {
    $("importState").textContent = "Archivio locale · " + err.message;
  }
  vectors();
  schedule();
}
start();
