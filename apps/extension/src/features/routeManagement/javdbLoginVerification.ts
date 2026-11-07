/** Account evidence only: never infer login from the existence of a session cookie. */
export type JavdbLoginState = 'authenticated' | 'anonymous' | 'unknown';
// JavDB's anonymous profile endpoint returns this entire JavaScript body with HTTP 200.
export const JAVDB_LOGIN_REDIRECT = /^\s*window\.location\.href\s*=\s*(['"])\/login\1;?\s*$/;
export const JAVDB_LOGIN_PATH = /^\/(?:login|sign[_-]?in|users\/sign[_-]?in)\/?$/i;
export const JAVDB_LOGOUT_PATH = /^\/(?:logout|sign[_-]?out|users\/(?:sign[_-]?out|logout))\/?$/i;

export function classifyJavdbLoginHtml(input: {
  html: string; url: string; origin: string; status: number;
}): JavdbLoginState {
  let final: URL;
  try {
    final = new URL(input.url);
    if (final.origin !== new URL(input.origin).origin) return 'unknown';
  } catch { return 'unknown'; }
  if (input.status < 200 || input.status >= 300) return 'unknown';
  if (JAVDB_LOGIN_REDIRECT.test(input.html)) return 'anonymous';
  const html = input.html.replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    .replace(/<(script|style|template)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '');
  if (/cf-challenge|challenge-form|cf-chl-|just a moment|checking your browser/i.test(html)) return 'unknown';
  let profile = false, personal = false, logout = false, login = false, password = false, loginForm = false;
  // Inspect actual tags/attributes, never strings embedded in text, comments or script.
  for (const match of html.matchAll(/<([a-z][\w:-]*)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi)) {
    const tag = match[1].toLowerCase();
    const attrs: Record<string, string> = {};
    for (const attr of match[2].matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
      attrs[attr[1].toLowerCase()] = attr[2] ?? attr[3] ?? attr[4] ?? '';
    }
    if (tag === 'input' && attrs.type?.toLowerCase() === 'password') password = true;
    const href = tag === 'a' ? attrs.href : tag === 'form' ? attrs.action : undefined;
    if (!href) continue;
    try {
      const url = new URL(href.replace(/&amp;/g, '&'), final);
      if (url.origin !== final.origin) continue;
      const path = url.pathname.replace(/\/+$/, '') || '/';
      if (tag === 'a') {
        profile ||= path === '/users/profile';
        personal ||= /^\/users\/(?:want_watch_videos|watched_videos)$/.test(path);
        logout ||= JAVDB_LOGOUT_PATH.test(path);
        login ||= JAVDB_LOGIN_PATH.test(path);
      } else loginForm ||= JAVDB_LOGIN_PATH.test(path);
    } catch { /* Unrecognized markup is not evidence. */ }
  }
  const authenticated = profile && (logout || personal);
  const anonymous = login || (password && (loginForm || JAVDB_LOGIN_PATH.test(final.pathname)));
  if (authenticated && anonymous) return 'unknown';
  if (authenticated) return 'authenticated';
  return anonymous ? 'anonymous' : 'unknown';
}
