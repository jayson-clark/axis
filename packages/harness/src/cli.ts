#!/usr/bin/env node
// ═════════════════════════════════════════════════════════════════════════════
// axis-inspect — what does Desmos actually make of this script?
// ═════════════════════════════════════════════════════════════════════════════
//
// The command an agent runs. It compiles a script, loads it into a real
// headless calculator, and prints what came back: every expression with the
// verdict Desmos reached on it, the graph state, and any errors. `--json` makes
// that machine-readable; the default is a summary meant to be read.
//
// Exit code 1 means the graph has errors, so it works in a check without
// anybody having to parse the output.

import { writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { createImageResolver, loadImages } from '@axis-dsl/compiler';
import { AxisCalculator, Inspection, InspectedExpression, withCalculator } from './calculator';
import { nodeImageHost, readAxisFile } from './files';

interface Args {
    file?: string;
    source?: string;
    json: boolean;
    errorsOnly: boolean;
    evaluate: string[];
    screenshot?: string;
    apiKey?: string;
    offline: boolean;
    help: boolean;
}

const USAGE = `axis-inspect — run an Axis script against a real headless Desmos calculator

Usage
  axis-inspect <file.axis> [options]
  axis-inspect -e '<source>' [options]   compile a script given inline
  axis-inspect - [options]            read the script from stdin

Options
  --json                  print the whole inspection as JSON
  --errors-only           print only what Desmos rejected
  -e, --source <source>   the script itself, instead of a file
      --eval <expr>       also evaluate an Axis expression against the loaded
                          graph, e.g. --eval 'f(20)' (repeatable)
  --screenshot <file>     write a PNG of the graphpaper
  --api-key <key>         Desmos API key (default: the public demo key)
  --offline               fail rather than fetch from desmos.com
  -h, --help              show this

Exits 1 if any expression is in error.`;

function parseArgs(argv: string[]): Args {
    const args: Args = {
        json: false,
        errorsOnly: false,
        evaluate: [],
        offline: false,
        help: false,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        const next = () => {
            const value = argv[index + 1];
            if (value === undefined) {
                throw new Error(`${arg} needs a value`);
            }
            index += 1;
            return value;
        };

        switch (arg) {
            case '--json':
                args.json = true;
                break;
            case '--errors-only':
                args.errorsOnly = true;
                break;
            case '--eval':
                args.evaluate.push(next());
                break;
            case '-e':
            case '--source':
                args.source = next();
                break;
            case '--screenshot':
                args.screenshot = next();
                break;
            case '--api-key':
                args.apiKey = next();
                break;
            case '--offline':
                args.offline = true;
                break;
            case '-h':
            case '--help':
                args.help = true;
                break;
            default:
                if (arg.startsWith('-') && arg !== '-') {
                    throw new Error(`Unknown option ${arg}`);
                }
                args.file = arg;
        }
    }

    return args;
}

async function readStdin(): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
        chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf8');
}

/**
 * A script with no file of its own still draws pictures that have one, so its
 * images are read relative to the working directory.
 */
async function resolveLooseImages(source: string) {
    const host = nodeImageHost();
    return createImageResolver(
        await loadImages({ path: '', source }, new Map(), host),
        host.resolve,
    );
}

/** The script to run, however it was named, with its imports and images resolved. */
async function resolveScript(args: Args) {
    if (args.source !== undefined) {
        return {
            name: '<inline>',
            source: args.source,
            resolveImport: undefined,
            resolveImage: await resolveLooseImages(args.source),
        };
    }
    if (args.file === undefined || args.file === '-') {
        const source = await readStdin();
        return {
            name: '<stdin>',
            source,
            resolveImport: undefined,
            resolveImage: await resolveLooseImages(source),
        };
    }
    const loaded = await readAxisFile(args.file);
    return {
        name: basename(loaded.path),
        source: loaded.source,
        path: loaded.path,
        resolveImport: loaded.resolveImport,
        resolveImage: loaded.resolveImage,
    };
}

function describe(expression: InspectedExpression): string {
    const label = expression.latex ?? expression.title ?? expression.text ?? expression.type;
    const analysis = expression.analysis;

    if (!analysis) {
        return `  ${expression.index}  ${expression.type.padEnd(10)} ${label}`;
    }
    if (analysis.isError) {
        return `  ${expression.index}  error      ${label}\n        ↳ ${analysis.errorMessage}`;
    }

    const value = analysis.evaluation;
    const evaluated =
        value === undefined
            ? ''
            : value.type === 'Number'
              ? ` = ${value.value}`
              : ` = [${value.value.slice(0, 8).join(', ')}${value.value.length > 8 ? ', …' : ''}]`;
    const kind = analysis.isGraphable ? 'graphable' : 'ok';
    return `  ${expression.index}  ${kind.padEnd(10)} ${label}${evaluated}`;
}

function report(name: string, inspection: Inspection, evaluated: [string, unknown][]): void {
    const { expressions, errors, consoleErrors } = inspection;
    console.log(`${name} — ${expressions.length} expressions, ${errors.length} errors\n`);

    for (const expression of expressions) {
        console.log(describe(expression));
    }

    // The ticker is in the graph but not in the list, so it would otherwise be
    // the one thing a script can say that this report never mentions.
    const ticker = inspection.state.expressions?.ticker;
    if (ticker?.handlerLatex) {
        const paced = ticker.minStepLatex ? ` every ${ticker.minStepLatex}ms` : '';
        console.log(
            `\n  ticker     ${ticker.handlerLatex}${paced}${ticker.playing ? ' (playing)' : ''}`,
        );
    }

    if (evaluated.length > 0) {
        console.log('\nEvaluated');
        for (const [latex, value] of evaluated) {
            console.log(`  ${latex} = ${JSON.stringify(value)}`);
        }
    }

    if (consoleErrors.length > 0) {
        console.log('\nPage errors');
        for (const message of consoleErrors) {
            console.log(`  ${message}`);
        }
    }
}

async function evaluateAll(
    calculator: AxisCalculator,
    expressions: string[],
): Promise<[string, unknown][]> {
    const results: [string, unknown][] = [];
    for (const latex of expressions) {
        const value = await calculator.evaluate(latex);
        results.push([latex, value.listValue.length > 0 ? value.listValue : value.numericValue]);
    }
    return results;
}

async function main(): Promise<number> {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        console.log(USAGE);
        return 0;
    }

    const script = await resolveScript(args);

    return withCalculator(
        async calculator => {
            await calculator.load(script.source, {
                path: 'path' in script ? script.path : undefined,
                resolveImport: script.resolveImport,
                resolveImage: script.resolveImage,
            });

            const inspection = await calculator.inspect();
            const evaluated = await evaluateAll(calculator, args.evaluate);

            if (args.screenshot) {
                const dataUri = await calculator.screenshot({ width: 800, height: 600 });
                const base64 = dataUri.slice(dataUri.indexOf(',') + 1);
                await writeFile(args.screenshot, Buffer.from(base64, 'base64'));
            }

            if (args.json) {
                console.log(
                    JSON.stringify(
                        {
                            file: script.name,
                            ...(args.errorsOnly ? { errors: inspection.errors } : inspection),
                            evaluated: Object.fromEntries(evaluated),
                        },
                        null,
                        2,
                    ),
                );
            } else if (args.errorsOnly) {
                for (const error of inspection.errors) {
                    console.log(`${error.index}  ${error.latex ?? error.id}\n  ↳ ${error.message}`);
                }
            } else {
                report(script.name, inspection, evaluated);
            }

            return inspection.errors.length > 0 ? 1 : 0;
        },
        { apiKey: args.apiKey, offline: args.offline },
    );
}

main().then(
    code => {
        process.exitCode = code;
    },
    (error: unknown) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 2;
    },
);
