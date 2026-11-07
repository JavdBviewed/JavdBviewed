import { describe, expect, it } from 'vitest';
import { classifyJavdbLoginHtml } from './javdbLoginVerification';

const origin = 'https://javdb575.com';
const profile = '<nav id="navbar-menu-user"><a href="/users/profile">Account</a><a href="/logout">Exit</a></nav><a href="/users/want_watch_videos">List</a>';
const check = (html: string, url = `${origin}/users/profile`, status = 200) => classifyJavdbLoginHtml({ html, url, status, origin });
describe('verified JavDB login', () => {
  it('requires positive personal navigation evidence, not merely 200 or a cookie', () => {
    expect(check(profile)).toBe('authenticated');
    expect(check('<html>OK</html>')).toBe('unknown');
    expect(check('<a href="/users/profile">Account</a>')).toBe('unknown');
  });
  it('recognizes a real login navigation or form', () => {
    expect(check('<nav id="navbar-menu-user"><a href="/login">Sign in</a></nav>')).toBe('anonymous');
    expect(check('<form action="/login"><input type="password"></form>', `${origin}/login`)).toBe('anonymous');
    expect(check('<h1>login advice</h1>')).toBe('unknown');
  });
  it('does not trust challenges, errors, foreign redirects, or conflicting evidence', () => {
    expect(check(`<div id="cf-challenge">Checking</div>${profile}`)).toBe('unknown');
    expect(check(profile, `${origin}/users/profile`, 403)).toBe('unknown');
    expect(check(profile, 'https://other.example/users/profile')).toBe('unknown');
    expect(check(`${profile}<nav id="navbar-menu-user"><a href="/login">Sign in</a></nav>`)).toBe('unknown');
  });
  it('ignores script, comments and external links masquerading as account markers', () => {
    expect(check(`<script>${profile}</script><!-- ${profile} -->`)).toBe('unknown');
    expect(check('<a href="https://other.example/users/profile">A</a><a href="https://other.example/logout">B</a>')).toBe('unknown');
    expect(check('<div data-note="href=\'/users/profile\'">help</div><a href="/logout">B</a>')).toBe('unknown');
  });
});
it('recognizes only the entire known login-wall redirect, never a script embedded in account HTML', () => {
  expect(check("window.location.href='/login';")).toBe('anonymous');
  expect(check('  window.location.href = "/login";\n')).toBe('anonymous');
  expect(check("window.location.href='https://other.example/login';")).toBe('unknown');
  expect(check("window.location.href='/login'; doSomething();")).toBe('unknown');
  expect(check(`${profile}<script>window.location.href='/login';</script>`)).toBe('authenticated');
});
