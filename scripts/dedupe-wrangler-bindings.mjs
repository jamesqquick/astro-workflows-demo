#!/usr/bin/env node
/**
 * Workaround for @astrojs/cloudflare@13.3.x bug where user-defined
 * kv_namespaces from wrangler.jsonc are merged twice into the generated
 * dist/server/wrangler.json, causing "binding assigned to multiple KV
 * Namespace bindings" errors at wrangler dev / deploy time.
 *
 * This script dedupes kv_namespaces (and a few other binding arrays for
 * good measure) by binding name, keeping the first occurrence so user
 * config wins.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const target = resolve(process.cwd(), "dist/server/wrangler.json");

if (!existsSync(target)) {
	console.error(`[dedupe-wrangler-bindings] ${target} does not exist; skipping.`);
	process.exit(0);
}

const config = JSON.parse(readFileSync(target, "utf8"));

const dedupeBy = (arr, key = "binding") => {
	if (!Array.isArray(arr)) return arr;
	const seen = new Set();
	const out = [];
	for (const item of arr) {
		const k = item?.[key];
		if (k && seen.has(k)) continue;
		if (k) seen.add(k);
		out.push(item);
	}
	return out;
};

const bindingArrays = [
	"kv_namespaces",
	"r2_buckets",
	"d1_databases",
	"queues",
	"vectorize",
	"hyperdrive",
	"services",
];

let changed = false;
for (const key of bindingArrays) {
	const before = config[key];
	if (Array.isArray(before)) {
		const after = dedupeBy(before);
		if (after.length !== before.length) {
			config[key] = after;
			changed = true;
			console.log(
				`[dedupe-wrangler-bindings] ${key}: ${before.length} → ${after.length} entries`,
			);
		}
	}
}

if (changed) {
	writeFileSync(target, JSON.stringify(config, null, 2));
	console.log(`[dedupe-wrangler-bindings] wrote ${target}`);
} else {
	console.log(`[dedupe-wrangler-bindings] no duplicates found.`);
}
