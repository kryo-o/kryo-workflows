import { schedules, logger } from "@trigger.dev/sdk";

const TARGET_LEADS = 25;
const MAX_SEARCHES = 15;
const MIN_REVIEWS = 10;
const MAX_REVIEWS = 300;

const CATEGORIES = [
  "HVAC company",
  "plumber",
  "roofing contractor",
  "electrician",
  "pool service",
  "pest control",
  "dentist",
  "chiropractor",
  "med spa",
  "law firm",
  "CPA accounting firm",
  "insurance agency",
  "real estate agent",
];

const CITIES = [
  "Tampa",
  "St. Petersburg",
  "Clearwater",
  "Brandon",
  "Largo",
  "Wesley Chapel",
  "Lakeland",
  "Sarasota",
  "Bradenton",
  "New Port Richey",
];

// Hosts shared by many unrelated businesses — never treat as a dedupe key
const SHARED_HOSTS = ["facebook.com", "instagram.com", "business.site", "sites.google.com", "linktr.ee", "yelp.com", "wixsite.com", "godaddysites.com"];

type Place = {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  businessStatus?: string;
  googleMapsUri?: string;
};

type ClickUpTask = { id: string; name: string; description?: string; date_created: string };

// Keys identifying one business: place ID, phone digits, website domain
export function dedupeKeys(placeId?: string, phone?: string, website?: string): string[] {
  const keys: string[] = [];
  if (placeId) keys.push(`place:${placeId}`);
  const digits = phone?.replace(/\D/g, "").slice(-10);
  if (digits && digits.length === 10) keys.push(`phone:${digits}`);
  if (website) {
    try {
      const host = new URL(website).hostname.replace(/^www\./, "").toLowerCase();
      if (!SHARED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) keys.push(`site:${host}`);
    } catch {}
  }
  return keys;
}

export function taskKeys(task: ClickUpTask): string[] {
  const field = (label: string) => task.description?.match(new RegExp(`^${label}: (.+)$`, "m"))?.[1].trim();
  return dedupeKeys(field("Place ID"), field("Phone"), field("Website"));
}

// Oldest task wins; returns every later task that shares a key with an earlier one
export function findDuplicates(tasks: ClickUpTask[]): ClickUpTask[] {
  const seen = new Set<string>();
  const dupes: ClickUpTask[] = [];
  for (const t of [...tasks].sort((a, b) => Number(a.date_created) - Number(b.date_created))) {
    const keys = taskKeys(t);
    if (keys.some((k) => seen.has(k))) dupes.push(t);
    keys.forEach((k) => seen.add(k));
  }
  return dupes;
}

async function clickup(path: string, token: string, init: RequestInit = {}) {
  const res = await fetch(`https://api.clickup.com/api/v2${path}`, {
    ...init,
    headers: { Authorization: token, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`ClickUp ${init.method ?? "GET"} ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function listAllTasks(listId: string, token: string): Promise<ClickUpTask[]> {
  const all: ClickUpTask[] = [];
  for (let page = 0; ; page++) {
    const data = await clickup(`/list/${listId}/task?page=${page}&include_closed=true&subtasks=true`, token);
    all.push(...data.tasks);
    if (data.last_page || data.tasks.length === 0) return all;
  }
}

async function searchPlaces(query: string, apiKey: string): Promise<Place[]> {
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.businessStatus,places.googleMapsUri",
    },
    body: JSON.stringify({ textQuery: query, pageSize: 20 }),
  });
  if (!res.ok) throw new Error(`Google Places search failed: ${res.status} ${await res.text()}`);
  return (await res.json()).places ?? [];
}

export const findTampaLeads = schedules.task({
  id: "find-tampa-leads",
  cron: { pattern: "0 8 * * 1", timezone: "America/New_York" },
  queue: { concurrencyLimit: 1 }, // overlapping runs could race past the dedupe check
  run: async () => {
    const placesKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!placesKey) throw new Error("GOOGLE_PLACES_API_KEY is not set");
    const clickupToken = process.env.CLICKUP_API_TOKEN;
    if (!clickupToken) throw new Error("CLICKUP_API_TOKEN is not set");
    const listId = process.env.CLICKUP_LIST_ID;
    if (!listId) throw new Error("CLICKUP_LIST_ID is not set");

    // Pre-check: every key already in the list
    const existing = await listAllTasks(listId, clickupToken);
    const seen = new Set(existing.flatMap(taskKeys));
    logger.info(`ClickUp list has ${existing.length} tasks`);

    // 13 categories × 10 cities are coprime, so i % 13 / i % 10 walks all 130 combos.
    // ponytail: offset by week number; full cycle ~9 weeks, dedupe covers repeats
    const week = Math.floor(Date.now() / (7 * 24 * 3600 * 1000));
    const createdIds = new Set<string>();
    let searches = 0;

    for (let i = week * MAX_SEARCHES; searches < MAX_SEARCHES && createdIds.size < TARGET_LEADS; i++, searches++) {
      const category = CATEGORIES[i % CATEGORIES.length];
      const city = CITIES[i % CITIES.length];
      const places = await searchPlaces(`${category} in ${city}, FL`, placesKey);
      let added = 0;

      for (const p of places) {
        if (createdIds.size >= TARGET_LEADS) break;
        const reviews = p.userRatingCount ?? 0;
        if (p.businessStatus !== "OPERATIONAL" || !p.websiteUri || !p.nationalPhoneNumber) continue;
        if (reviews < MIN_REVIEWS || reviews > MAX_REVIEWS) continue;
        const keys = dedupeKeys(p.id, p.nationalPhoneNumber, p.websiteUri);
        if (keys.some((k) => seen.has(k))) continue;

        const description = [
          `Category: ${category}`,
          `City: ${city}`,
          `Phone: ${p.nationalPhoneNumber}`,
          `Website: ${p.websiteUri}`,
          `Address: ${p.formattedAddress ?? ""}`,
          `Rating: ${p.rating ?? "n/a"} (${reviews} reviews)`,
          `Google Maps: ${p.googleMapsUri ?? ""}`,
          `Place ID: ${p.id}`,
        ].join("\n");

        const task = await clickup(`/list/${listId}/task`, clickupToken, {
          method: "POST",
          // custom_item_id null = standard "Task" type. Details stay in description only:
          // ClickUp Free caps custom task type and custom field usage workspace-wide.
          body: JSON.stringify({ name: p.displayName?.text ?? "Unknown business", description, custom_item_id: null }),
        });
        createdIds.add(task.id);
        keys.forEach((k) => seen.add(k));
        added++;
      }
      logger.info(`"${category} in ${city}": ${places.length} results, ${added} new leads`);
    }

    // Post-check: re-read full list, remove any duplicate this run created
    const dupes = findDuplicates(await listAllTasks(listId, clickupToken));
    let deleted = 0;
    const flagged: string[] = [];
    for (const d of dupes) {
      if (createdIds.has(d.id)) {
        await clickup(`/task/${d.id}`, clickupToken, { method: "DELETE" });
        deleted++;
      } else {
        flagged.push(`${d.name} (${d.id})`);
      }
    }
    if (flagged.length) logger.warn(`Older duplicates found (not auto-deleted): ${flagged.join(", ")}`);

    const result = { searches, created: createdIds.size - deleted, duplicatesDeleted: deleted, duplicatesFlagged: flagged.length };
    logger.info("Done", result);
    return result;
  },
});
