import { chromium } from "playwright";

const url = "https://www.cuckoo.co.kr/mall/productList?categoryCd=1";
const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ viewport: null });
const page = await context.newPage();

await page.goto(url, { waitUntil: "domcontentloaded" });
console.log("쿠쿠 밥솥 페이지를 열었습니다. 종료하려면 브라우저를 닫으세요.");

await page.waitForEvent("close");
await browser.close();
