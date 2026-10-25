// req-coverage: fixtures-only — a reader of Maestro's command lines for the tests of the L7 script, not a requirement's proof.
import { describe, expect, test } from 'vitest';
import { flowsRunBy, maestroTags, optionValues, type FlowOnDisk } from './maestro-flows.ts';

const FOLDER = 'apps/mobile/e2e';

const FLOWS: FlowOnDisk[] = [
  { name: 'a-plain.yaml', tags: [] },
  { name: 'b-scripted.yaml', tags: ['scripted'] },
  { name: 'c-both.yaml', tags: ['scripted', 'slow'] },
  { name: 'd-slow.yaml', tags: ['slow'] },
];

describe('maestroTags: a flow’s tags, from its config section', () => {
  test('reads a block list and a flow sequence, quoted or not, and nothing after the first ---', () => {
    expect(maestroTags('appId: x\ntags:\n  - scripted\n  - "slow"\n---\n- launchApp\n')).toEqual([
      'scripted',
      'slow',
    ]);
    expect(maestroTags("appId: x\ntags: [scripted, 'slow']\n---\n")).toEqual(['scripted', 'slow']);
    expect(maestroTags('appId: x\n---\ntags:\n  - scripted\n')).toEqual([]);
  });

  test('a flow with no tags, or no config section, has none; comments are not tags', () => {
    expect(maestroTags('appId: x\n---\n- launchApp\n')).toEqual([]);
    expect(maestroTags('- launchApp\n')).toEqual([]);
    expect(maestroTags('# tags:\n#   - scripted\nappId: x\n---\n')).toEqual([]);
  });
});

describe('flowsRunBy: what a `maestro test` command line runs', () => {
  test('the folder runs every flow in it; --exclude-tags leaves the tagged ones out, in either spelling', () => {
    const base = ['/m/maestro', 'test', '--format', 'junit', '--output', 'r.xml'];

    expect(flowsRunBy([...base, FOLDER], { folder: FOLDER, flows: FLOWS })).toEqual(
      FLOWS.map(({ name }) => name),
    );
    expect(
      flowsRunBy([...base, '--exclude-tags', 'scripted', `${FOLDER}/`], {
        folder: FOLDER,
        flows: FLOWS,
      }),
    ).toEqual(['a-plain.yaml', 'd-slow.yaml']);
    expect(
      flowsRunBy([...base, '--exclude-tags=scripted', `/abs/${FOLDER}`], {
        folder: FOLDER,
        flows: FLOWS,
      }),
    ).toEqual(['a-plain.yaml', 'd-slow.yaml']);
  });

  test('--include-tags keeps only the tagged ones, and an excluded tag wins', () => {
    expect(
      flowsRunBy(['maestro', 'test', '--include-tags', 'slow', FOLDER], {
        folder: FOLDER,
        flows: FLOWS,
      }),
    ).toEqual(['c-both.yaml', 'd-slow.yaml']);
    expect(
      flowsRunBy(['maestro', 'test', '--include-tags=slow', '--exclude-tags=scripted', FOLDER], {
        folder: FOLDER,
        flows: FLOWS,
      }),
    ).toEqual(['d-slow.yaml']);
  });

  test('flow files named one by one run alone; option values are never read as flows', () => {
    expect(
      flowsRunBy(
        [
          'maestro',
          'test',
          '--config',
          `${FOLDER}/config.yaml`,
          '-e',
          'APP_ID=x.yaml',
          `${FOLDER}/b-scripted.yaml`,
        ],
        { folder: FOLDER, flows: FLOWS },
      ),
    ).toEqual(['b-scripted.yaml']);
    expect(
      flowsRunBy(['maestro', 'test', 'one.yaml', 'two.yml'], { folder: FOLDER, flows: FLOWS }),
    ).toEqual(['one.yaml', 'two.yml']);
    expect(flowsRunBy(['maestro', '--version'], { folder: FOLDER, flows: FLOWS })).toEqual([]);
  });

  test('optionValues reads both spellings and splits at commas', () => {
    expect(optionValues(['--exclude-tags', 'a,b', '--exclude-tags=c'], '--exclude-tags')).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
});
