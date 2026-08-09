/**
 * Password policy, shared by the API and the web app so both judge a password
 * by exactly the same rule — the UI can warn as it is typed, and the server
 * still refuses independently.
 *
 * Deliberately modest: these accounts belong to plant staff typing on a phone
 * at a batching panel, not to security engineers. A rule people can satisfy
 * beats a strict one they work around by writing it on the wall.
 */
export const PASSWORD_MIN_LENGTH = 10;

const COMMON_START = /^(password|passw0rd|welcome|admin|administrator|demo|test|sample|changeme|letmein|qwerty|abc123|123456|mixnova|rmc123)/i;

/** Everything wrong with a password, phrased to be shown to the person. */
export function passwordProblems(password: string): string[] {
  const problems: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) {
    problems.push(`be at least ${PASSWORD_MIN_LENGTH} characters`);
  }
  if (!/[a-zA-Z]/.test(password)) problems.push('include a letter');
  if (!/[0-9]/.test(password)) problems.push('include a number');
  if (COMMON_START.test(password)) problems.push('not start with a common word like "password" or "admin"');
  if (/^\s|\s$/.test(password)) problems.push('not begin or end with a space');
  return problems;
}

export const isPasswordAcceptable = (password: string): boolean => passwordProblems(password).length === 0;

/** One sentence naming everything to fix, ready to show or throw. */
export function passwordProblemMessage(password: string): string | null {
  const problems = passwordProblems(password);
  if (!problems.length) return null;
  return `The password must ${problems.join(', ')}.`;
}
