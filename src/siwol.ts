import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type BrowserContext } from "playwright";

const sourceUrl = "https://siwolmobile.com/btcview.do";
const statePath = ".auth/siwol-state.json";
const profilePath = ".auth/siwol-profile";
const outputPath = "data/siwol-usage.json";
const mode = process.argv[2];

async function saveAuthentication(context: BrowserContext) {
  const cookies = (await context.cookies(sourceUrl)).filter(
    (cookie) => cookie.name === "JSESSIONID",
  );
  if (cookies.length !== 1) {
    throw new Error("시월모바일 인증 쿠키를 확인할 수 없습니다.");
  }
  // Session cookies do not reliably survive a browser restart in the profile alone.
  await writeFile(statePath, `${JSON.stringify({ cookies, origins: [] }, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

async function main() {
  if (mode !== "login" && mode !== "usage") {
    throw new Error("사용법: npm run login:siwol 또는 npm run usage:siwol");
  }

  let savedState: { cookies: Parameters<BrowserContext["addCookies"]>[0] } | undefined;
  try {
    savedState = JSON.parse(await readFile(statePath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error("인증 상태 파일을 읽을 수 없습니다. .auth/siwol-state.json을 확인하세요.");
    }
  }
  if (mode === "usage" && !savedState) {
    console.error("저장된 인증이 없습니다. npm run login:siwol로 SMS 로그인하세요.");
    process.exitCode = 2;
    return;
  }

  await mkdir(".auth", { recursive: true, mode: 0o700 });
  const context = await chromium.launchPersistentContext(resolve(profilePath), {
    headless: mode === "usage",
    viewport: mode === "login" ? null : { width: 1365, height: 768 },
  });
  try {
    if (savedState) {
      await context.addCookies(savedState.cookies);
    }
    const page = context.pages()[0] ?? (await context.newPage());
    const response = await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    if (!response?.ok()) {
      throw new Error(`사용량 페이지 요청 실패: HTTP ${response?.status() ?? "응답 없음"}`);
    }
    const heading = page.getByRole("heading", { name: "사용량 조회", exact: true });
    if (!(await heading.isVisible())) {
      const loginRequired = new URL(page.url()).pathname === "/sign.do";
      if (!loginRequired) {
        throw new Error("사용량 조회 섹션을 찾을 수 없습니다. 사이트 응답을 확인하세요.");
      }
      if (mode === "usage") {
        console.error("인증이 만료되었습니다. npm run login:siwol로 SMS 재인증하세요.");
        process.exitCode = 2;
        return;
      }
      console.log("브라우저에서 가입자 인증으로 SMS 로그인하세요. 사용량 페이지가 표시되면 인증을 저장합니다.");
      await heading.waitFor({ state: "visible", timeout: 0 });
    }

    if (mode === "login") {
      await saveAuthentication(context);
      console.log("인증 저장 완료: .auth/siwol-state.json\n조회: npm run usage:siwol");
      return;
    }

    const section = page.locator(".content_box").filter({ has: heading });
    const usage = await section.evaluate((element) => {
      const queriedAt = element.querySelector(".amount_refresh")?.textContent?.trim().replace(/^조회시각:\s*/, "");
      const plan = element.querySelector(".box_guide .text_semibold")?.textContent?.trim();
      const period = element.querySelector(".box_guide .text_sm_size")?.textContent?.match(
        /사용기간\s+(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})/,
      );
      if (!queriedAt || !plan || !period) {
        throw new Error("사용량 조회시각, 요금제 또는 사용기간 형식을 인식할 수 없습니다.");
      }
      const groups = Array.from(element.querySelectorAll(".amount_info"), (group) => {
        const name = group.querySelector(".box_title")?.textContent?.trim();
        if (!name) throw new Error("사용량 그룹 이름이 없습니다.");
        const items = Array.from(group.querySelectorAll(".price_list > li"), (row) => {
          const label = Array.from(row.childNodes)
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => node.textContent)
            .join("")
            .replace(/\s+/g, " ")
            .trim();
          const amount = row.querySelector(".amount")?.textContent?.trim() ?? "";
          const match = amount.match(/^([\d,]+(?:\.\d+)?)\s*\/\s*([\d,]+(?:\.\d+)?)\s*제공$/);
          if (!label || !match) {
            throw new Error("사용량 항목 형식을 인식할 수 없습니다.");
          }
          return {
            label,
            used: Number(match[1].replaceAll(",", "")),
            provided: Number(match[2].replaceAll(",", "")),
          };
        });
        return { name, items };
      });
      if (!groups.some((group) => group.items.length > 0)) {
        throw new Error("사용량 항목이 없습니다.");
      }
      return { queriedAt, period: { from: period[1], to: period[2] }, plan, groups };
    });

    await saveAuthentication(context);
    await mkdir("data", { recursive: true });
    await writeFile(
      outputPath,
      `${JSON.stringify({ collectedAt: new Date().toISOString(), sourceUrl, ...usage }, null, 2)}\n`,
      "utf8",
    );
    console.log(JSON.stringify(usage, null, 2));
    console.log(`저장 완료: ${outputPath}`);
  } finally {
    await context.close();
  }
}

try {
  await main();
} catch {
  // Browser errors may contain session-bearing URLs or cookie values; never print them.
  console.error("시월모바일 실행 실패. 네트워크, 사이트 변경 또는 프로필 중복 실행 여부를 확인하세요.");
  process.exitCode = 1;
}
