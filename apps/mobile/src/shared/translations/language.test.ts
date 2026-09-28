// INF-06-AC4: which language the app speaks, chosen from the device's own
// ordered list of preferred languages.
//
// The rule is short on purpose: take the first language the app has. nb, nn
// and no all mean bokmål (D-014: the app ships in bokmål, and nynorsk readers
// read it), en means English, and a device that asks for none of them gets
// bokmål.
//
// A pure function over language tags such as "nb-NO", so every case is one row
// here and nothing needs a device.
import { describe, expect, test } from '@jest/globals';

import { chooseLanguage } from './language';

describe('chooseLanguage', () => {
  // No parentheses anywhere inside this table: the test counter behind RG-03
  // reads a test.each only up to its first closing parenthesis.
  test.each([
    { device: ['nb-NO'], expected: 'nb', why: 'bokmål is bokmål' },
    { device: ['nn-NO'], expected: 'nb', why: 'nynorsk readers get bokmål' },
    { device: ['no'], expected: 'nb', why: 'plain Norwegian means bokmål' },
    { device: ['nb'], expected: 'nb', why: 'a tag without a region still counts' },
    { device: ['en-GB'], expected: 'en', why: 'English is English' },
    { device: ['en-US'], expected: 'en', why: 'whichever English it is' },
    { device: ['en-GB', 'nb-NO'], expected: 'en', why: 'the first language the app has wins' },
    { device: ['nb-NO', 'en-GB'], expected: 'nb', why: 'the order is the device owner’s' },
    { device: ['sv-SE', 'en-GB'], expected: 'en', why: 'a language the app lacks is passed over' },
    { device: ['sv-SE', 'nn-NO', 'en-GB'], expected: 'nb', why: 'passed over, then nynorsk' },
    { device: ['nl-NL', 'en-GB'], expected: 'en', why: 'Dutch is not Norwegian' },
    { device: ['sv-SE', 'de-DE'], expected: 'nb', why: 'nothing the app has means bokmål' },
    { device: [], expected: 'nb', why: 'an empty list means bokmål' },
  ])('INF-06-AC4: $why — $device gives $expected', ({ device, expected }) => {
    expect(chooseLanguage(device)).toBe(expected);
  });
});
