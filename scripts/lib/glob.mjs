// The same small glob matcher the hooks use, so a path that counts as a test
// file for a hook counts as one for the gate scripts too.

/** Turns a glob into a regular expression anchored at both ends. */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if ('\\^$+.()|{}[]'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp('^' + re + '$');
}

export function matchesGlob(filePath, glob) {
  return globToRegExp(glob).test(filePath);
}

export function matchesAnyGlob(filePath, globs) {
  return globs.some((glob) => matchesGlob(filePath, glob));
}
