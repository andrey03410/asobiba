import { access, kanameEnabled, problem, reportAuthorized, type Grant } from "@kaname/service-client";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Services } from "./app";
import { SESSION_COOKIE } from "./routes";

export function siteIdentity(subject: string) {
  const kanameIssuer = process.env.KANAME_OIDC_ISSUER;
  if (!kanameIssuer) throw problem(503, "Служба входа не настроена.");
  return { kanameIssuer, kanameSubject: subject };
}
export async function usage(context: Services, subject: string) {
  const row = await context.db.user.findUnique({
    where: { kanameIssuer_kanameSubject: siteIdentity(subject) },
    select: { id: true },
  });
  if (!row) return { storageBytes: 0, counts: { configs: 0, lobbies: 0 }, lastActiveAt: null, activeDays30: 0 };
  const since = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const days = await context.db.kanameActivity.findMany({
    where: { issuer: process.env.KANAME_OIDC_ISSUER!, subject, day: { gte: since } },
    orderBy: { day: "desc" },
  });
  const last = await context.db.kanameActivity.findFirst({
    where: { issuer: process.env.KANAME_OIDC_ISSUER!, subject },
    orderBy: { day: "desc" },
    select: { lastActiveAt: true },
  });
  const [assets, video, configs, lobbies] = await Promise.all([
    context.db.asset.aggregate({ where: { ownerId: row.id }, _sum: { bytes: true } }),
    context.video.poolBytes(row.id),
    context.db.gameConfig.count({ where: { ownerId: row.id } }),
    context.db.lobby.count({ where: { hostId: row.id, status: { not: "closed" } } }),
  ]);
  const storageBytes = (assets._sum.bytes ?? 0) + video,
    counts = { configs, lobbies };
  return {
    storageBytes,
    counts,
    lastActiveAt: last?.lastActiveAt.toISOString() ?? null,
    activeDays30: days.length,
  };
}

function escape(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function registerKanamePanel(app: FastifyInstance, context: Services) {
  if (!kanameEnabled()) return;
  async function principal(request: FastifyRequest) {
    const user = await context.auth.userBySession(request.cookies[SESSION_COOKIE]);
    if (!user || user.role === "guest") return null;
    return grantForUser(context.db, user.id);
  }
  async function admin(request: FastifyRequest) {
    const grant = await principal(request);
    if (!grant || grant.role === "user") throw problem(403, "Требуются права администратора площадки.");
    return grant;
  }
  app.get<{ Params: { subject: string } }>("/internal/kaname/v1/usage/:subject", async (request, reply) => {
    if (!reportAuthorized(request.headers.authorization)) throw problem(403, "Нет доступа.");
    return reply.header("cache-control", "no-store").send(await usage(context, request.params.subject));
  });
  app.get("/api/kaname/account", async (request) => {
    const grant = await principal(request);
    if (!grant) throw problem(403, "Нет доступа.");
    return { limits: grant.limits, role: grant.role, usage: await usage(context, grant.subject) };
  });
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string", bodyLimit: 2048 },
    (_req, body, done) => done(null, Object.fromEntries(new URLSearchParams(String(body)))),
  );
  app.post<{ Body: { subject?: string; suspended?: string } }>("/admin/access", async (request, reply) => {
    const operator = await admin(request);
    if (request.headers.origin !== new URL(process.env.KANAME_SITE_URL!).origin)
      throw problem(403, "Запрос должен быть отправлен со страницы управления.");
    const { subject, suspended } = request.body;
    if (!subject || !["1", "0"].includes(suspended ?? "")) throw problem(400, "Проверьте данные запроса.");
    const target = await access("asobiba", subject);
    if (
      operator.subject === subject ||
      target.role === "overlord" ||
      (operator.role === "admin" && target.role === "admin")
    )
      throw problem(403, "Недостаточно прав.");
    await context.db.user.update({
      where: { kanameIssuer_kanameSubject: siteIdentity(subject) },
      data: { kanameSuspended: suspended === "1" },
    });
    return reply.redirect("/admin", 303);
  });
  app.post<{ Body: { id: string } }>("/admin/lobbies/close", async (request, reply) => {
    await admin(request);
    if (request.headers.origin !== new URL(process.env.KANAME_SITE_URL!).origin)
      throw problem(403, "Неверный источник.");
    const actor = await context.auth.userBySession(request.cookies[SESSION_COOKIE]);
    if (!actor) throw problem(403, "Требуется вход.");
    if (typeof request.body?.id !== "string" || !request.body.id || request.body.id.length > 128)
      throw problem(400, "Укажите объект управления.");
    const target = await context.db.lobby.findFirst({
      where: { id: request.body.id, host: { kanameIssuer: process.env.KANAME_OIDC_ISSUER! } },
      select: { id: true },
    });
    if (!target) throw problem(404, "Лобби не найдено.");
    await context.lobbies.close(actor, target.id, true);
    return reply.redirect("/admin", 303);
  });
  app.get("/admin", async (request, reply) => {
    if (!request.cookies[SESSION_COOKIE]) return reply.redirect("/api/auth/kaname/login?next=/admin");
    const operator = await admin(request);
    const rows = await context.db.user.findMany({
      where: { kanameIssuer: process.env.KANAME_OIDC_ISSUER!, kanameSubject: { not: null } },
      orderBy: { displayName: "asc" },
    });
    const list = await Promise.all(
      rows.map(async (row) => {
        const report = await usage(context, row.kanameSubject!);
        const grant = await access("asobiba", row.kanameSubject!).catch((error) => {
          if (error.statusCode === 403) return null;
          throw error;
        });
        const maySuspend =
          !!grant &&
          operator.subject !== grant.subject &&
          grant.role !== "overlord" &&
          (operator.role === "overlord" || grant.role === "user");
        const action = row.kanameSuspended ? "Восстановить" : "Приостановить";
        const button = maySuspend
          ? `<form method="post" action="/admin/access"><input type="hidden" name="subject"
          value="${escape(row.kanameSubject!)}"><button name="suspended" value="${row.kanameSuspended ? "0" : "1"}">${action}</button></form>`
          : "";
        const status = !grant ? "Нет назначения" : row.kanameSuspended ? "Приостановлен" : "Активен";
        return `<tr><td>${escape(row.displayName ?? "")}</td><td>${new Intl.NumberFormat("ru").format(report.storageBytes)} Б</td>
        <td>${report.activeDays30}</td><td>${status}</td><td>${button}</td></tr>`;
      }),
    );
    const lobbies = await context.db.lobby.findMany({
      where: { status: { not: "closed" }, host: { kanameIssuer: process.env.KANAME_OIDC_ISSUER! } },
      select: { id: true, name: true },
    });
    const detail =
      "<h2>Открытые лобби</h2>" +
      lobbies
        .map(
          (l) =>
            '<form method="post" action="/admin/lobbies/close">' +
            escape(l.name) +
            ' <button name="id" value="' +
            escape(l.id) +
            '">Закрыть</button></form>',
        )
        .join("");
    return reply
      .header("cache-control", "no-store")
      .header(
        "content-security-policy",
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      )
      .type("text/html;charset=utf-8").send(`<!doctype html><html lang="ru"><meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1"><title>Asobiba · Управление</title>
      <style>body{font:16px system-ui;max-width:64rem;margin:3rem auto;padding:0 1rem;color:#242821}section{overflow:auto}
      table{width:100%;border-collapse:collapse}th,td{padding:.7rem;text-align:left;border-bottom:1px solid #ddd}button{padding:.4rem .6rem}a{color:#27503e}</style>
      <nav><a href="/">Asobiba</a> · <a href="${escape(process.env.KANAME_PUBLIC_URL!)}">Kaname</a></nav>
      <h1>Управление Asobiba</h1><section><table><thead><tr><th>Участник</th><th>Занято</th><th>Дни за месяц</th>
      <th>Доступ</th><th>Действия</th></tr></thead><tbody>${list.join("")}</tbody></table></section>${detail}</html>`);
  });
  app.addHook("onResponse", async (request, reply) => {
    if (
      reply.statusCode >= 400 ||
      request.method === "OPTIONS" ||
      !(request.method !== "GET" && /^\/api\/(configs|lobbies|assets|video)/.test(request.url))
    )
      return;
    const grant = await principal(request).catch(() => null);
    if (!grant) return;
    await recordActivity(context, grant.subject);
  });
}

export async function grantForUser(db: Services["db"], id: string) {
  if (!kanameEnabled()) return null;
  const user = await db.user.findUnique({
    where: { id },
    select: { kanameIssuer: true, kanameSubject: true, kanameSuspended: true },
  });
  if (!user?.kanameSubject || user.kanameIssuer !== process.env.KANAME_OIDC_ISSUER || user.kanameSuspended)
    throw problem(403, "Доступ к Asobiba приостановлен.");
  return access("asobiba", user.kanameSubject);
}

export async function recordActivity(context: Services, subject: string) {
  const { kanameIssuer: issuer } = siteIdentity(subject);
  const lastActiveAt = new Date();
  const key = { issuer, subject, day: lastActiveAt.toISOString().slice(0, 10) };
  await context.db.kanameActivity.upsert({
    where: { issuer_subject_day: key },
    create: { ...key, lastActiveAt },
    update: { lastActiveAt },
  });
}
