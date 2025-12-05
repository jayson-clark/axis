// ═════════════════════════════════════════════════════════════════════════════
// The viewer protocol
// ═════════════════════════════════════════════════════════════════════════════
//
// The viewer is a display surface driven entirely by these messages — it has no
// other way in. Both hosts speak them: the extension over VSCode's postMessage
// bridge, the playground over an in-memory channel. One path means a feature is
// built once and both hosts get it.

import type { CalculatorOptions, DesmosExpression } from '@axis-dsl/desmos';

/** Host → viewer. */
export type ViewerMessage =
    | {
          command: 'init';
          data: {
              desmosApiKey: string;
              /**
               * Whether this host can act on `requestApiKey`. The viewer only
               * offers the affordance when someone is listening: the extension
               * opens VSCode settings, while a host with a key baked in has
               * nowhere to put one.
               */
              canSetApiKey?: boolean;
          };
      }
    | {
          command: 'setExpressions';
          data: { expressions: DesmosExpression[]; settings?: CalculatorOptions };
      }
    /** Free text shown in the tab strip — a count, "Compiling…", null to clear. */
    | { command: 'setStatus'; data: { status: string | null } };

/** Viewer → host. */
export type HostMessage =
    /** Sent on mount. The host answers with `init` and the current expressions. */
    | { command: 'ready' }
    /** Sent only to a host that set `canSetApiKey`; only it knows where one goes. */
    | { command: 'requestApiKey' };

export type AxisMessage = ViewerMessage | HostMessage;
