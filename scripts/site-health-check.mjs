const site = "https://headless-jcrzxssmnuf-myastate-1408.wix-site-host.com";
const supabase = "https://qebuxmnvgkksueikhxya.supabase.co";
const publishableKey = "sb_publishable_Gmm2akNrvAWGR_LNXLFwsQ_Rn3EMKEk";

const failures = [];
const timeout = 15000;

async function request(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function checkPage(path, marker) {
  try {
    const res = await request(site + path, { headers: { "Accept": "text/html,text/plain,application/xml" } });
    const text = await res.text();
    if (!res.ok) throw new Error("HTTP " + res.status);
    if (marker && !text.toLowerCase().includes(marker.toLowerCase())) throw new Error("expected page marker not found");
    console.log("PASS page", path, res.status);
  } catch (error) {
    failures.push("Page " + path + ": " + (error instanceof Error ? error.message : String(error)));
    console.error("FAIL page", path, error instanceof Error ? error.message : String(error));
  }
}

async function checkGateway() {
  const url = supabase + "/functions/v1/property-gateway";
  try {
    const res = await request(url, {
      headers: { "apikey": publishableKey, "Accept": "application/json", "Origin": site }
    });
    const data = await res.json();
    if (!res.ok || data.ok !== true || !Array.isArray(data.listings)) {
      throw new Error("feed contract failed (HTTP " + res.status + ")");
    }
    const ids = data.listings.map(x => x.publicId).filter(Boolean);
    if (new Set(ids).size !== ids.length) throw new Error("duplicate public IDs in feed");
    for (const item of data.listings) {
      if (!["BUY", "SELL"].includes(String(item.listingType || ""))) throw new Error("unexpected listing type");
      if (!item.description || String(item.description).length > 1800) throw new Error("listing description invalid");
    }
    console.log("PASS gateway public feed", res.status, "records:", data.count);
  } catch (error) {
    failures.push("Supabase public feed: " + (error instanceof Error ? error.message : String(error)));
    console.error("FAIL gateway public feed", error instanceof Error ? error.message : String(error));
  }
}

async function checkInvalidSubmissionIsRejected() {
  const url = supabase + "/functions/v1/property-gateway";
  try {
    const res = await request(url, {
      method: "POST",
      headers: {
        "apikey": publishableKey,
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Origin": site
      },
      body: JSON.stringify({ message: "Selling cosmetics and skincare products in Pune", honeypot: "" })
    });
    const body = await res.json().catch(() => ({}));
    if (res.status !== 400 || body.ok !== false) {
      throw new Error("non-property submission was not rejected (HTTP " + res.status + ")");
    }
    console.log("PASS invalid non-property submission rejected", res.status);
  } catch (error) {
    failures.push("Invalid-post rejection check: " + (error instanceof Error ? error.message : String(error)));
    console.error("FAIL invalid-post rejection check", error instanceof Error ? error.message : String(error));
  }
}

await Promise.all([
  checkPage("/", "Astate"),
  checkPage("/submit.html", "post"),
  checkPage("/listings.html", "published"),
  checkPage("/privacy.html", "privacy"),
  checkPage("/robots.txt", "sitemap"),
  checkPage("/sitemap.xml", ""),
  checkPage("/llms.txt", "Astate"),
  checkGateway(),
  checkInvalidSubmissionIsRejected()
]);

if (failures.length) {
  console.error("\nAstate health-check failures:\n- " + failures.join("\n- "));
  process.exitCode = 1;
} else {
  console.log("\nAstate daily health check passed.");
}
