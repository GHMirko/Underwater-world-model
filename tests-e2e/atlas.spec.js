import { test, expect } from "@playwright/test";

test("Terra/Mare mantiene AOI e quote durante lo zoom", async ({ page }) => {
  await page.goto("/Underwater-world-model/");
  await expect(page.locator("#source option")).toHaveCount(3);
  await page.locator("#draw").click();
  const map = page.locator("#map");
  await map.click({ position: { x: 360, y: 380 } });
  await map.click({ position: { x: 655, y: 630 } });
  await expect(page.locator("#extent")).toContainText("AOI fissata");
  for (const n of [5, 3]) {
    await page.locator("#count").fill(String(n));
    await expect
      .poll(
        async () =>
          (await page.locator("#levels").innerText()).split(" · ").length - 1,
      )
      .toBe(n);
  }
  const levels = await page.locator("#levels").innerText();
  await page.locator(".leaflet-control-zoom-in").click();
  await page.locator("#terra").click();
  await expect(page.locator("#marine")).toBeHidden();
  await page.locator("#mare").click();
  await expect(page.locator("#levels")).toHaveText(levels);
});

test("Una zona ENC esclusa rimane esclusa quando il layer è nascosto", async ({
  page,
}) => {
  await page.goto("/Underwater-world-model/");
  await expect(page.locator("#source option")).toHaveCount(3);
  await page.locator("#draw").click();
  await page.locator("#map").click({ position: { x: 360, y: 380 } });
  await page.locator("#map").click({ position: { x: 655, y: 630 } });
  await expect(page.locator("#levels")).toContainText("Quote");
  await page.locator("summary").click();
  const data = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {
          _s57_layer: "RESARE",
          _source_cell: "TEST",
          RESTRN: "7",
        },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [9, 43],
              [11, 43],
              [11, 45],
              [9, 45],
              [9, 43],
            ],
          ],
        },
      },
    ],
  };
  await page
    .locator("#upload")
    .setInputFiles({
      name: "test.geojson",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(data)),
    });
  await expect(page.locator("#chartState")).toContainText("1 celle");
  await page.getByLabel("Escludi Ingresso vietato").check();
  await page.getByLabel("Mostra Ingresso vietato").uncheck();
  await expect(page.locator("#range")).toContainText(
    "Nessuna profondità valida",
  );
  await page.getByLabel("Escludi Ingresso vietato").uncheck();
  await expect(page.locator("#levels")).toContainText("Quote");
});
