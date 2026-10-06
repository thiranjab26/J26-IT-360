// @ts-check
/**
 * Privacy lint rules for the C02 load sensor (FR7, NFR2; CLAUDE.md invariants 1–3).
 *
 * Layers 1 and 2 of the privacy architecture (docs/c2/ARCHITECTURE.md §9):
 *  - no third-party asset hosts anywhere in src/ (zero runtime network dependency);
 *  - no API that exports or streams camera frames anywhere in src/;
 *  - no network API in src/core/, except the one same-origin model loader;
 *  - events/ and recorder/ cannot import the modules that hold frames or the landmark mesh.
 *
 * Kept in its own module so tests/unit/eslint-privacy.test.ts can prove each rule fires.
 */

/** Hosts that must never appear in source. Model and WASM files are served same-origin. */
export const BANNED_HOSTS = [
  'cdn.jsdelivr.net',
  'unpkg.com',
  'cdnjs.cloudflare.com',
  'esm.sh',
  'cdn.skypack.dev',
  'ga.jspm.io',
  'tfhub.dev',
  'kaggle.com',
  'storage.googleapis.com',
  'gstatic.com',
];

/** Network APIs banned in src/core (bare globals and as properties, e.g. navigator.sendBeacon). */
export const BANNED_NETWORK_APIS = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'WebTransport',
  'EventSource',
  'RTCPeerConnection',
  'MediaRecorder',
  'sendBeacon',
  'importScripts',
];

/** Methods that turn camera pixels into a transferable blob, URL or stream. */
export const BANNED_FRAME_EXPORTS = ['toDataURL', 'toBlob', 'convertToBlob', 'captureStream'];

/** The only file in src/core allowed to fetch: loads model files from same-origin paths. */
export const MODEL_LOADER = 'src/core/model-loader.ts';

const escapeRegex = (/** @type {string} */ s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const hostRegex = `/${BANNED_HOSTS.map(escapeRegex).join('|')}/i`;
const exactName = (/** @type {string[]} */ names) => `/^(${names.join('|')})$/`;

const hostMessage =
  'Third-party asset hosts are forbidden: serve models, WASM and scripts same-origin (CLAUDE.md invariant 3).';
const frameMessage =
  'Exporting or streaming camera frames is forbidden; frames never leave the device (CLAUDE.md invariant 1).';
const networkMessage = `Network APIs are forbidden in src/core; only ${MODEL_LOADER} may fetch, same-origin (ARCHITECTURE.md §9).`;

const hostSyntax = [
  { selector: `Literal[value=${hostRegex}]`, message: hostMessage },
  { selector: `TemplateElement[value.raw=${hostRegex}]`, message: hostMessage },
];

const frameSyntax = [
  {
    selector: `MemberExpression[property.name=${exactName(BANNED_FRAME_EXPORTS)}]`,
    message: frameMessage,
  },
];

const networkSyntax = [
  {
    selector: `MemberExpression[property.name=${exactName(BANNED_NETWORK_APIS)}]`,
    message: networkMessage,
  },
];

/** @type {import('eslint').Linter.Config[]} */
export const privacyConfig = [
  {
    name: 'c2/privacy/all-src',
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...hostSyntax, ...frameSyntax],
    },
  },
  {
    // Flat config replaces (not merges) a rule's options, so the src/ selectors are repeated here.
    name: 'c2/privacy/core-no-network',
    files: ['src/core/**/*.ts'],
    ignores: [MODEL_LOADER],
    rules: {
      'no-restricted-syntax': ['error', ...hostSyntax, ...frameSyntax, ...networkSyntax],
      'no-restricted-globals': [
        'error',
        ...BANNED_NETWORK_APIS.map((name) => ({ name, message: networkMessage })),
      ],
    },
  },
  {
    // Frames live only in camera/ and landmarks/ (ARCHITECTURE.md §9). The event stream and the
    // study recorder must only ever see derived numbers, never frames or the 478-point mesh.
    name: 'c2/privacy/no-frames-downstream',
    files: ['src/core/events/**/*.ts', 'src/core/recorder/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '(^|/)(camera|landmarks)(/|$)',
              message:
                'events/ and recorder/ may not import camera/ or landmarks/: they receive derived numbers only (ARCHITECTURE.md §9).',
            },
          ],
        },
      ],
    },
  },
];
