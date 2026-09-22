// ═════════════════════════════════════════════════════════════════════════════
// Styles - metadata with a name, resolved away before lowering
// ═════════════════════════════════════════════════════════════════════════════
//
// `use: name` in a metadata clause stands for the properties of the style it
// names, as though they had been written there (spec §4.5). A clause may use
// several, and a style may use others; they apply in the order written, and a
// property the clause writes for itself beats every style it uses, wherever in
// the clause the `use:` stands - which is the rule that makes a style a default
// rather than an override.
//
// What comes out is the clause's *effective* properties, one per name, each
// still the tree node it was written as. Lowering reads those exactly as it
// reads a property written in place, so a style needs nothing of its own there.
// Unlike a macro, using a style leaves the statement writable: the `use:` is
// itself source, and writing the statement back writes the `use:` back.

import type { Property } from '@axis-dsl/syntax';
import type { StyleDefinition } from './symbols';

/**
 * The properties a clause amounts to once its styles are applied, by name.
 * `entries` is the clause as written; `use` entries are consumed.
 */
export function resolveProperties(
    entries: readonly Property[],
    styles: ReadonlyMap<string, StyleDefinition>,
): Map<string, Property> {
    const resolved = new Map<string, Property>();

    for (const entry of entries) {
        if (entry.key.name === 'use') {
            for (const [name, property] of styleProperties(entry, styles, [])) {
                resolved.set(name, property);
            }
        }
    }

    for (const entry of entries) {
        if (entry.key.name !== 'use') {
            resolved.set(entry.key.name, entry);
        }
    }

    return resolved;
}

/**
 * What one `use:` brings, its style's own `use:`s applied first.
 *
 * `active` is the chain of styles being resolved: a style that uses itself,
 * directly or round a loop, is an error the checker reports, and here it is
 * simply not followed a second time.
 */
export function styleProperties(
    use: Property,
    styles: ReadonlyMap<string, StyleDefinition>,
    active: readonly string[],
): Map<string, Property> {
    const name = use.value?.kind === 'Identifier' ? use.value.name : undefined;
    const style = name === undefined ? undefined : styles.get(name);
    const properties = new Map<string, Property>();

    if (!style || active.includes(style.name)) {
        return properties;
    }

    const chain = [...active, style.name];
    for (const entry of style.entries) {
        if (entry.key.name === 'use') {
            for (const [key, property] of styleProperties(entry, styles, chain)) {
                properties.set(key, property);
            }
        }
    }
    for (const entry of style.entries) {
        if (entry.key.name !== 'use') {
            properties.set(entry.key.name, entry);
        }
    }

    return properties;
}
