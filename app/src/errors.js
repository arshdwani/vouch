// Error messages people see. No Forge imports, so it is unit-testable.
// Jira and Confluence failures carry the HTTP status, product and step; they become plain sentences here, and the raw
// response only goes to the app logs. Vouch's own checks throw UserError, whose message is already written for people.
export class UserError extends Error {}

const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);

export function friendly(e) {
  if (e instanceof UserError || e?.name === 'ZipError') return e.message;
  const status = Number(e?.status) || 0;
  if (!status) return 'Something went wrong in Vouch. Please try again.';
  const product = e.product || 'Jira';
  const doing = e.what ? lower(e.what) : 'that';
  if (status === 401 || status === 403) return `Couldn't finish ${doing}: ${product} says you don't have permission.`;
  if (status === 404) return `Couldn't finish ${doing}: ${product} couldn't find it. It may have been deleted or moved.`;
  if (status === 413) return `Couldn't finish ${doing}: the file is too large.`;
  if (status === 429) return `${product} is busy right now. Wait a minute and try again.`;
  if (status < 500) return `Couldn't finish ${doing}: ${product} didn't accept the request.`;
  return `${product} didn't respond in time. Try again in a moment.`;
}
