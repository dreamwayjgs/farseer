import { mkdir, writeFile } from "node:fs/promises";
import { chromium, type Page, type Response } from "playwright";

const sourceUrl = "https://www.cuckoo.co.kr/mall/productList?categoryCd=1";
const outputPath = "data/cuckoo-rice-cookers.json";

type Product = {
  productNo: number;
  productNm: string;
  productCd: string;
  showProductCd: string;
  price: number;
  salePrice: number;
  salePer: number;
  stockYn: string | null;
  note: string | null;
  smImagePath: string | null;
  reviewCnt: number;
  starCnt: number;
  [key: string]: unknown;
};

type ProductSearchResponse = {
  productList: Product[];
  page: number;
  pageCount: number;
  pageNo: number;
};

const isProductResponse = (response: Response) =>
  response.url().includes("/rest/mall/mallProductSearch") &&
  response.request().method() === "POST";

async function readProducts(response: Response) {
  return (await response.json()) as ProductSearchResponse;
}

async function loadAllPages(page: Page) {
  const firstResponsePromise = page.waitForResponse(isProductResponse);
  await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  let result = await readProducts(await firstResponsePromise);
  const products = new Map(result.productList.map((product) => [product.productNo, product]));
  const moreButton = page.locator("#ui_more_btn");
  const pageLabel = await moreButton.innerText();
  const pageNumbers = pageLabel.match(/(\d+)\s*\/\s*(\d+)/);
  if (!pageNumbers) {
    throw new Error(`더보기 페이지 수를 읽을 수 없습니다: ${pageLabel}`);
  }
  let loadedPages = Number(pageNumbers[1]);
  const totalPages = Number(pageNumbers[2]);

  while (loadedPages < totalPages) {
    const responsePromise = page.waitForResponse(isProductResponse);
    await moreButton.click();
    result = await readProducts(await responsePromise);
    for (const product of result.productList) {
      products.set(product.productNo, product);
    }
    loadedPages += 1;
    console.log(`페이지 ${loadedPages}/${totalPages}: 누적 ${products.size}개`);
  }

  return { products: [...products.values()], loadedPages, expectedProducts: result.pageCount };
}

const browser = await chromium.launch();
const page = await browser.newPage();

try {
  const { products, loadedPages, expectedProducts } = await loadAllPages(page);
  const candidates = products.filter((product) => {
    const description = `${product.productNm} ${product.note ?? ""}`;
    return /\((6|10)인용/.test(product.productNm) && description.includes("트윈프레셔");
  });
  const renderedCount = await page.locator(".prd_list > ul > li[data-product-no]").count();
  const uniqueProductCodes = new Set(products.map((product) => product.productCd)).size;
  if (products.length !== expectedProducts || renderedCount !== expectedProducts) {
    throw new Error(
      `상품 수 불일치: API ${expectedProducts}, 고유 상품 ${products.length}, 화면 ${renderedCount}`,
    );
  }
  if (uniqueProductCodes !== products.length) {
    throw new Error(`중복 모델 코드 발견: ${products.length - uniqueProductCodes}개`);
  }
  const sixPersonCount = candidates.filter((product) => product.productNm.includes("(6인용")).length;
  const tenPersonCount = candidates.filter((product) => product.productNm.includes("(10인용")).length;

  await mkdir("data", { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify(
      {
        collectedAt: new Date().toISOString(),
        sourceUrl,
        loadedPages,
        expectedProducts,
        productCount: products.length,
        candidateCount: candidates.length,
        candidates,
        products,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  console.log(`저장 완료: 전체 ${products.length}개, 후보 ${candidates.length}개`);
  console.log(`후보 구성: 6인용 ${sixPersonCount}개, 10인용 ${tenPersonCount}개`);
  console.log(`화면 상품 카드: ${renderedCount}개`);
  console.log(outputPath);
} finally {
  await browser.close();
}
