// ═════════════════════════════════════════════════════════════════════════════
// Language configuration - brackets, comments, folding
// ═════════════════════════════════════════════════════════════════════════════

import configuration from '../language-configuration.json';

/**
 * Brackets, comments and folding markers for Axis.
 *
 * The JSON is the single source: VSCode's manifest points at the file directly
 * (it can only read one from disk), and the Monaco adapter imports this.
 */
export const AXIS_LANGUAGE_CONFIGURATION = configuration;

/** The language id and file extension both editors register under. */
export const AXIS_LANGUAGE_ID = 'axis';
export const AXIS_FILE_EXTENSION = '.axis';
