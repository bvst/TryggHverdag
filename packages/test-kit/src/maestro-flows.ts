/**
 * How Maestro 2.10.0 reads a flow's tags, and which flows a `maestro test`
 * command line runs: for the tests of scripts/e2e-android.mjs, which runs the
 * flows not tagged `scripted` in one run, and each flow tagged `scripted` in a
 * run of its own (INF-06-AC9; CALL-01, approach 9, D-031).
 *
 * How the first run leaves the scripted flows out is the script's choice
 * (CALL-01, approach 9): the flows' folder with `--exclude-tags scripted`, or
 * each flow file by name. Both are read here as Maestro reads them, so a test
 * can hold what a command runs without holding how it says so.
 */

/** A flow in the flows' folder: its file name, and its tags. */
export interface FlowOnDisk {
  name: string;
  tags: readonly string[];
}

/**
 * The tags in a flow's config section, the YAML before its first `---` line:
 * `tags:` as a block list (`  - scripted`) or a flow sequence (`[a, b]`).
 * Comments are left out. A flow with no config section, or no `tags:`, has none.
 */
export function maestroTags(flowText: string): string[] {
  const lines = flowText.split('\n');
  const end = lines.findIndex((line) => line.trim() === '---');
  if (end === -1) return [];
  const config = lines.slice(0, end).filter((line) => !line.trimStart().startsWith('#'));
  const at = config.findIndex((line) => /^tags\s*:/.test(line));
  if (at === -1) return [];
  const unquote = (value: string): string => value.trim().replace(/^(['"])(.*)\1$/, '$2');
  const inline = /^tags\s*:\s*\[(.*)\]\s*$/.exec(config[at] ?? '');
  if (inline !== null) {
    return (inline[1] ?? '').split(',').map(unquote).filter(Boolean);
  }
  const tags: string[] = [];
  for (const line of config.slice(at + 1)) {
    const item = /^\s+-\s+(.+?)\s*$/.exec(line);
    if (item === null) break;
    tags.push(unquote(item[1] ?? ''));
  }
  return tags;
}

/** `maestro test`'s options that take a value, so their values are not read as flows. */
const TAKES_A_VALUE = new Set([
  '--format',
  '--output',
  '--debug-output',
  '--test-output-dir',
  '--test-suite-name',
  '--udid',
  '--device',
  '--platform',
  '-p',
  '--env',
  '-e',
  '--include-tags',
  '--exclude-tags',
  '--config',
  '--shard-split',
  '--shard-all',
  '--host',
  '--port',
]);

/** The values `argv` gives `option`, as `option value` or `option=value`, each split at commas. */
export function optionValues(argv: readonly string[], option: string): string[] {
  const values: string[] = [];
  argv.forEach((arg, i) => {
    if (arg === option) values.push(argv[i + 1] ?? '');
    else if (arg.startsWith(`${option}=`)) values.push(arg.slice(option.length + 1));
  });
  return values
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean);
}

/** What `argv` names that is no option and no option's value, after the program and `test`. */
function operands(argv: readonly string[]): string[] {
  const found: string[] = [];
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (TAKES_A_VALUE.has(arg)) {
      i += 1;
    } else if (!arg.startsWith('-')) {
      found.push(arg);
    }
  }
  const test = found.indexOf('test');
  return test === -1 ? found : found.slice(test + 1);
}

/**
 * The flows a `maestro test` command line runs, by file name, sorted: every
 * flow file it names, and, when it names the flows' `folder`, each of its
 * `flows` that the line's --include-tags and --exclude-tags leave in. An
 * excluded tag leaves a flow out even when an included one would keep it, as
 * in Maestro.
 *
 * @param argv the command line, the program first
 */
export function flowsRunBy(
  argv: readonly string[],
  { folder, flows }: { folder: string; flows: readonly FlowOnDisk[] },
): string[] {
  const include = optionValues(argv, '--include-tags');
  const exclude = optionValues(argv, '--exclude-tags');
  const run = new Set<string>();
  for (const operand of operands(argv)) {
    const trimmed = operand.replace(/\/+$/, '');
    if (trimmed === folder || trimmed.endsWith(`/${folder}`)) {
      for (const flow of flows) {
        const kept =
          !flow.tags.some((tag) => exclude.includes(tag)) &&
          (include.length === 0 || flow.tags.some((tag) => include.includes(tag)));
        if (kept) run.add(flow.name);
      }
    } else if (/\.ya?ml$/.test(trimmed)) {
      run.add(trimmed.split('/').at(-1) ?? trimmed);
    }
  }
  return [...run].sort();
}
