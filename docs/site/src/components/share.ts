// A script, carried in a playground link's fragment: `#code=` and the UTF-8
// source in base64url. Written at build time under every example on the site,
// and read by the playground in the browser - both have `btoa` and `atob`. A
// fragment never reaches a server, so the script goes nowhere but the page.

const PREFIX = '#code=';

export function encodeSource(source: string): string {
    const bytes = new TextEncoder().encode(source);
    const binary = String.fromCharCode(...bytes);
    return PREFIX + btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The script a fragment carries, or undefined for any other fragment. */
export function decodeSource(hash: string): string | undefined {
    if (!hash.startsWith(PREFIX)) return undefined;
    try {
        const base64 = hash.slice(PREFIX.length).replace(/-/g, '+').replace(/_/g, '/');
        const binary = atob(base64);
        return new TextDecoder().decode(Uint8Array.from(binary, c => c.charCodeAt(0)));
    } catch {
        return undefined;
    }
}
