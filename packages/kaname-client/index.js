import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import * as oidc from 'openid-client';

export function kanameEnabled() { return process.env.KANAME_ENABLED === '1'; }
function required(key) {
  const value = process.env['KANAME_' + key];
  if (!value) throw new Error('Missing KANAME_' + key);
  return value;
}
export function problem(statusCode, message) { return Object.assign(new Error(message), {statusCode}); }
export function reportAuthorized(header) {
  const digest = value => createHash('sha256').update(value).digest();
  return typeof header === 'string' && timingSafeEqual(digest(header), digest('Bearer ' + required('REPORT_TOKEN')));
}
export async function access(service, subject) {
  if (!subject) throw problem(403, 'Доступ к сервису закрыт.');
  const url = new URL('/internal/v1/access/' + encodeURIComponent(subject), required('URL'));
  let response;
  try {
    response = await fetch(url, {headers:{Authorization:'Bearer ' + required('SERVICE_TOKEN')},signal:AbortSignal.timeout(4000),redirect:'error'});
  } catch { throw problem(503, 'Kaname временно недоступен.'); }
  if (response.status === 403) throw problem(403, 'Доступ к сервису закрыт.');
  if (!response.ok) throw problem(503, 'Не удалось проверить права в Kaname.');
  const grant = await response.json();
  const validLimit = value => value === null || Number.isSafeInteger(value) && value >= 0;
  if (grant.subject !== subject || grant.service !== service || !['user','admin','overlord'].includes(grant.role)
    || typeof grant.login !== 'string' || !grant.login || typeof grant.permissions?.heavy !== 'boolean'
    || typeof grant.permissions?.html !== 'boolean' || !['storageBytes','items','configs','lobbies','groups','projects','publications'].every(key => validLimit(grant.limits?.[key]))) {
    throw problem(503, 'Kaname вернул некорректные права.');
  }
  if (grant.role === 'overlord' && subject !== required('OWNER_SUBJECT')) throw problem(403, 'Не подтверждён владелец площадки.');
  return grant;
}
export function registerLogin(app, service, signIn) {
  app.get('/api/auth/kaname/config', async () => ({enabled:kanameEnabled(), guestsEnabled:kanameEnabled() && process.env.KANAME_GUESTS === '1', publicUrl:kanameEnabled() ? required('PUBLIC_URL') : null}));
  if (!kanameEnabled()) return;
  const issuer = new URL(required('OIDC_ISSUER'));
  const local = issuer.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(issuer.hostname) && process.env.NODE_ENV !== 'production';
  const callback = new URL('/api/auth/kaname/callback', required('SITE_URL'));
  const cookie = 'kaname_flow_' + service;
  const path = '/api/auth/kaname';
  const options = {path, httpOnly:true, sameSite:'lax', secure:callback.protocol === 'https:'};
  const attempts = new Map();
  let discovery;
  function configuration() {
    discovery ??= oidc.discovery(issuer,required('OIDC_CLIENT_ID'),required('OIDC_CLIENT_SECRET'),undefined,{timeout:5,execute:local ? [oidc.allowInsecureRequests, oidc.enableNonRepudiationChecks] : [oidc.enableNonRepudiationChecks]})
      .catch(() => { discovery = undefined; throw problem(503,'Сервис входа временно недоступен.'); });
    return discovery;
  }
  app.get(path + '/login', async (request, reply) => {
    const candidate = request.query?.next;
    const next = typeof candidate === 'string' && /^\/(?:admin|account|settings|(?:lobby|chat)\/[A-Za-z0-9_-]{1,100})?$/.test(candidate) ? candidate : '/';
    const config = await configuration();
    for (const [id, entry] of attempts) if (entry.until <= Date.now()) attempts.delete(id);
    if (attempts.size >= 4096) throw problem(429,'Повторите вход позже.');
    const id = randomBytes(32).toString('base64url'), verifier = oidc.randomPKCECodeVerifier(), state = oidc.randomState(), nonce = oidc.randomNonce();
    attempts.set(id,{until:Date.now()+300000, verifier,state,nonce,next});
    const redirect = oidc.buildAuthorizationUrl(config,{redirect_uri:callback.href,response_type:'code',scope:'openid profile',state,nonce,
      code_challenge:await oidc.calculatePKCECodeChallenge(verifier),code_challenge_method:'S256'});
    return reply.header('cache-control','no-store').setCookie(cookie,id,{...options,maxAge:300}).redirect(redirect.href);
  });
  app.get(path + '/callback', async (request, reply) => {
    const id = request.cookies[cookie];
    const entry = attempts.get(id);
    attempts.delete(id);
    reply.clearCookie(cookie,options).header('cache-control','no-store').header('referrer-policy','no-referrer');
    if (!entry || entry.until <= Date.now()) throw problem(401,'Срок входа истёк. Войдите снова.');
    const url = new URL(callback);
    url.search = new URL(request.url,callback.origin).search;
    let subject;
    try {
      const tokens = await oidc.authorizationCodeGrant(await configuration(),url,{expectedState:entry.state,expectedNonce:entry.nonce,pkceCodeVerifier:entry.verifier,idTokenExpected:true});
      subject = tokens.claims()?.sub;
    } catch { throw problem(401,'Не удалось подтвердить вход.'); }
    if (!subject) throw problem(401,'Не удалось подтвердить аккаунт.');
    await signIn(await access(service,subject),reply);
    return reply.redirect(entry.next);
  });
}
