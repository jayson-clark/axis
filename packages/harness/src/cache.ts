// ═════════════════════════════════════════════════════════════════════════════
// The Desmos asset cache
// ═════════════════════════════════════════════════════════════════════════════
//
// A real calculator means the real calculator.js, and that lives on desmos.com.
// Fetching it on every test run would make the suite depend on somebody else's
// uptime, so every response the page pulls from desmos.com is written to disk
// the first time and served from there afterwards — the script itself, and the
// fonts and chunks it goes on to ask for. After one warm run the harness needs
// no network at all.
//
// The cache is keyed by URL under the API version this package is written
// against, so bumping DESMOS_API_VERSION starts a fresh one rather than mixing
// two calculators' assets.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DESMOS_API_VERSION } from '@axis-dsl/desmos';

/** A response as it was cached: enough to fulfill the request again. */
export interface CachedAsset {
    body: Buffer;
    contentType: string;
}

/**
 * Where assets are written. `AXIS_HARNESS_CACHE` overrides it — point CI's
 * cache action at that directory to keep runs off the network.
 */
export function cacheDirectory(): string {
    const override = process.env.AXIS_HARNESS_CACHE;
    if (override) {
        return override;
    }
    const base = process.env.XDG_CACHE_HOME || join(homedir(), '.cache');
    return join(base, 'axis-harness', DESMOS_API_VERSION);
}

/**
 * A URL's cache entry. The hash is what makes it a filename; the readable
 * prefix is only there so a person looking in the directory can tell what they
 * are looking at.
 */
function entryPath(url: string): string {
    const hash = createHash('sha256').update(url).digest('hex').slice(0, 32);
    const name = (new URL(url).pathname.split('/').pop() || 'index').replace(/[^\w.-]/g, '_');
    return join(cacheDirectory(), `${name.slice(-40)}-${hash}`);
}

async function readCached(path: string): Promise<CachedAsset | undefined> {
    try {
        const [body, contentType] = await Promise.all([
            readFile(path),
            readFile(`${path}.type`, 'utf8'),
        ]);
        return { body, contentType };
    } catch {
        return undefined;
    }
}

async function writeCached(path: string, asset: CachedAsset): Promise<void> {
    await mkdir(cacheDirectory(), { recursive: true });
    await Promise.all([writeFile(path, asset.body), writeFile(`${path}.type`, asset.contentType)]);
}

export interface FetchAssetOptions {
    /** Never touch the network: a miss is an error rather than a download. */
    offline?: boolean;
}

/**
 * `url`'s response, from disk if it has been seen before and from desmos.com if
 * it has not. A failed fetch is not cached, so a run that happened to be
 * offline does not poison the next one.
 */
export async function fetchAsset(
    url: string,
    options: FetchAssetOptions = {},
): Promise<CachedAsset> {
    const path = entryPath(url);

    const cached = await readCached(path);
    if (cached) {
        return cached;
    }

    if (options.offline) {
        throw new Error(
            `${url} is not in the Desmos asset cache (${cacheDirectory()}) and the harness is ` +
                `offline. Run once with network access to warm the cache.`,
        );
    }

    const response = await fetch(url);
    if (!response.ok) {
        // A bad API key is the common one: Desmos answers it with a 403 whose
        // body is not JavaScript, so the failure is worth naming here rather
        // than leaving it to surface later as "Desmos is not defined".
        throw new Error(`Could not fetch ${url}: ${response.status} ${response.statusText}`);
    }

    const asset: CachedAsset = {
        body: Buffer.from(await response.arrayBuffer()),
        contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    };

    await writeCached(path, asset);
    return asset;
}
