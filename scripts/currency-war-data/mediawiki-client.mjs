const API_URL = "https://wiki.biligame.com/sr/api.php";

export async function fetchPageRevisions(titles, options = {}) {
  const batchSize = options.batchSize ?? 40;
  const result = new Map();
  for (let offset = 0; offset < titles.length; offset += batchSize) {
    const batch = titles.slice(offset, offset + batchSize);
    const data = await request({
      action: "query",
      format: "json",
      formatversion: "2",
      prop: "revisions",
      rvprop: "ids|timestamp|content",
      rvslots: "main",
      titles: batch.join("|"),
    }, options);
    for (const page of data.query?.pages ?? []) {
      const revision = page.revisions?.[0];
      if (page.missing || !revision) throw new Error(`CURRENCY_WAR_SOURCE_PAGE_MISSING:${page.title}`);
      result.set(page.title, {
        title: page.title,
        revisionId: revision.revid,
        updatedAt: revision.timestamp,
        content: revision.slots?.main?.content ?? "",
      });
    }
    if (offset + batchSize < titles.length) await sleep(options.delayMs ?? 350);
  }
  return result;
}

export async function askSemantic(query, options = {}) {
  const data = await request({ action: "ask", format: "json", query }, options);
  return data.query?.results ?? {};
}

async function request(parameters, options) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxAttempts = options.maxAttempts ?? 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const url = new URL(API_URL);
    url.search = new URLSearchParams(parameters);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
    try {
      const response = await fetchImpl(url, {
        headers: {
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138.0 Safari/537.36",
          accept: "application/json,text/plain,*/*",
          "accept-language": "zh-CN,zh;q=0.9",
          referer: "https://wiki.biligame.com/sr/",
          "x-client-name": "Cyrene-Agent-Replica-Lab currency-war-data",
        },
        signal: controller.signal,
      });
      if (response.ok) return await response.json();
      if (![429, 500, 502, 503, 504, 567].includes(response.status) || attempt === maxAttempts) {
        throw new Error(`CURRENCY_WAR_SOURCE_HTTP_${response.status}`);
      }
    } catch (error) {
      if (attempt === maxAttempts) throw error;
    } finally {
      clearTimeout(timeout);
    }
    await sleep((options.retryDelayMs ?? 800) * attempt);
  }
  throw new Error("CURRENCY_WAR_SOURCE_RETRY_EXHAUSTED");
}

function sleep(milliseconds) {
  return milliseconds > 0 ? new Promise((resolve) => setTimeout(resolve, milliseconds)) : Promise.resolve();
}
