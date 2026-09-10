import { chromium } from "playwright";

const sourceUrl = "https://prod.danawa.com/list/?cate=112775";

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();

try {
  await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });

  const maximumPrice = page.locator("#priceRangeMaxPriceOnSimpleSearchOption");
  await maximumPrice.waitFor({ timeout: 60_000 });
  await maximumPrice.fill("100000");
  await page.locator("#priceRangeSearchButtonSimple").click();
  await page.locator('li[id^="productItem"]').first().waitFor();

  const atxFilter = page.locator("#searchAttributeValue22391");
  await atxFilter.click();
  await page.waitForTimeout(1_000);

  await page.getByText("신상품순", { exact: true }).click();
  await page.waitForTimeout(1_000);

  console.log("대기 중");
  await new Promise<void>(() => {});
} finally {
  await browser.close();
}
