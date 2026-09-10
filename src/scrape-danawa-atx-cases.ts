import { mkdir, writeFile } from "node:fs/promises";
import { chromium, type Page } from "playwright";

const sourceUrl = "https://prod.danawa.com/list/?cate=112775";
const outputPath = "data/danawa-atx-cases.json";
const maximumPriceWon = 100_000;
const pageLimit = 8;

type Case = {
  productCode: string;
  modelName: string;
  productUrl: string;
  priceWon: number | null;
  specifications: string;
  supportedBoards: string[];
  widthMm: number | null;
  heightMm: number | null;
  depthMm: number | null;
  volumeLiters: number | null;
};

const parseMillimeters = (specifications: string, label: string) => {
  const match = specifications.match(new RegExp(`${label}:\\s*([\\d.]+)m{1,2}`));
  return match ? Number(match[1]) : null;
};

const parseCases = async (page: Page): Promise<Case[]> =>
  page.locator('#productListArea li[id^="productItem"]').evaluateAll((items) =>
    items.map((item) => {
      const productCode = item.id.replace("productItem", "");
      const nameLink = item.querySelector<HTMLAnchorElement>(".prod_name a");
      const priceText = item.querySelector(".price_sect")?.textContent ?? "";
      const specifications =
        item.querySelector(".spec-box--full .spec_list")?.textContent?.replace(/\s+/g, " ").trim() ?? "";
      return {
        productCode,
        modelName: nameLink?.textContent?.replace(/\s+/g, " ").trim() ?? "",
        productUrl: nameLink?.href ?? "",
        priceText,
        specifications,
      };
    }),
  ).then((products) =>
    products.map(({ priceText, specifications, ...product }) => {
      const boardMatch = specifications.match(/지원보드규격:\s*([^/]+)/);
      const widthMm = parseMillimeters(specifications, "너비\\(W\\)");
      const heightMm = parseMillimeters(specifications, "높이\\(H\\)");
      const depthMm = parseMillimeters(specifications, "깊이\\(D\\)");
      return {
        ...product,
        priceWon: Number(priceText.match(/([\d,]+)\s*원/)?.[1].replace(/,/g, "")) || null,
        specifications,
        supportedBoards: boardMatch?.[1].split(",").map((board) => board.trim()) ?? [],
        widthMm,
        heightMm,
        depthMm,
        volumeLiters:
          widthMm !== null && heightMm !== null && depthMm !== null
            ? Number(((widthMm * heightMm * depthMm) / 1_000_000).toFixed(2))
            : null,
      };
    }),
  );

const loadAllPages = async (page: Page) => {
  await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  const maximumPrice = page.locator("#priceRangeMaxPriceOnSimpleSearchOption");
  await maximumPrice.waitFor({ timeout: 60_000 });
  await maximumPrice.fill(String(maximumPriceWon));
  await page.locator("#priceRangeSearchButtonSimple").click();
  await page.locator('li[id^="productItem"]').first().waitFor();
  await page.waitForTimeout(1_000);
  const atxFilter = page.locator("#searchAttributeValue22391");
  await atxFilter.waitFor({ timeout: 60_000 });
  await atxFilter.click();
  await page.waitForTimeout(1_000);
  await page.getByText("신상품순", { exact: true }).click();
  await page.waitForTimeout(1_000);
  await page.locator('#productListArea li[id^="productItem"]').first().waitFor();

  const products = new Map<string, Case>();
  let pageNumber = 1;
  while (true) {
    for (const product of await parseCases(page)) {
      products.set(product.productCode, product);
    }
    console.log(`페이지 ${pageNumber}: 누적 ${products.size}개`);

    if (pageNumber === pageLimit) break;
    const nextPage = page.locator("#productListArea > div.prod_num_nav .num.now_on + .num");
    if (!(await nextPage.isVisible())) break;
    const firstProduct = page.locator('#productListArea li[id^="productItem"]').first();
    const previousProductCode = await firstProduct.getAttribute("id");
    await nextPage.click();
    await page.waitForFunction(
      (previous) => document.querySelector('#productListArea li[id^="productItem"]')?.id !== previous,
      previousProductCode,
    );
    pageNumber += 1;
  }

  return { products: [...products.values()], pageCount: pageNumber };
};

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();

try {
  const { products, pageCount } = await loadAllPages(page);
  const atxCases = products.filter((product) => product.supportedBoards.includes("ATX"));
  const overPriceCases = atxCases.filter(
    (product) => product.priceWon !== null && product.priceWon > maximumPriceWon,
  );
  if (overPriceCases.length > 0) {
    throw new Error(`가격 상한 불일치: ${overPriceCases.length}개`);
  }

  await mkdir("data", { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify(
      {
        collectedAt: new Date().toISOString(),
        sourceUrl,
        filter: { supportedBoard: "ATX", maximumPriceWon, sort: "신상품순" },
        pageLimit,
        pageCount,
        filterResultCount: products.length,
        excludedNonAtxCount: products.length - atxCases.length,
        productCount: atxCases.length,
        productsWithCompleteDimensions: atxCases.filter((product) => product.volumeLiters !== null).length,
        products: atxCases,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  console.log(`저장 완료: ATX 케이스 ${atxCases.length}개`);
  console.log(outputPath);
} finally {
  await browser.close();
}
