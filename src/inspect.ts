import { chromium } from "playwright";

const url = "https://www.cuckoo.co.kr/mall/productList?categoryCd=1";
const browser = await chromium.launch();
const page = await browser.newPage();

const productResponsePromise = page.waitForResponse((response) =>
  response.url().includes("/rest/mall/mallProductSearch"),
);
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.locator("#container").waitFor({ state: "attached", timeout: 30_000 });
const productResponse = await productResponsePromise;
await page.waitForTimeout(2_000);

const result = await page.evaluate(`(() => {
  const describe = (element) => element ? ({
    tag: element.tagName.toLowerCase(),
    id: element.id,
    className: element.className,
    text: element.textContent?.trim().replace(/\\s+/g, " ").slice(0, 300),
    childCount: element.children.length,
  }) : null;
  const byXPath = (xpath) => document.evaluate(
    xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
  ).singleNodeValue;
  const capacityLabels = [...document.querySelectorAll("label")]
    .filter((element) => /^(6인용|10인용)$/.test(element.textContent?.trim() ?? ""))
    .map((element) => ({
      label: describe(element),
      for: element.getAttribute("for"),
      parentHtml: element.parentElement?.outerHTML.slice(0, 500),
    }));
  const productLink = [...document.querySelectorAll(".prd_list a")]
    .find((element) => /^CRP-/.test(element.textContent?.trim() ?? ""));
  const classCounts = [...document.querySelectorAll(".prd_list [class]")]
    .reduce((counts, element) => {
      for (const className of element.classList) {
        counts[className] = (counts[className] ?? 0) + 1;
      }
      return counts;
    }, {});
  return {
    title: document.title,
    container: describe(byXPath('//*[@id="container"]/div[3]/div[2]/div[2]')),
    more: describe(document.querySelector("#ui_more_btn")),
    capacityLabels,
    productLinkHtml: productLink?.outerHTML.slice(0, 1500),
    productParentHtml: productLink?.parentElement?.outerHTML.slice(0, 2000),
    classCounts,
  };
})()`);

const apiBody = await productResponse.json();
console.dir(
  {
    result,
    productApi: {
      url: productResponse.url(),
      requestBody: productResponse.request().postData(),
      responseKeys: Object.keys(apiBody),
      responsePreview: JSON.stringify(apiBody).slice(0, 3_000),
    },
  },
  { depth: null },
);
await browser.close();
