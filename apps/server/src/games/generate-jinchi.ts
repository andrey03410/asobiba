import { generateMap, GenerationError, generationSchema } from '@asobiba/game-jinchi';
import type { AuthorInformation } from '@asobiba/sdk';
import type { Services } from '../app';
import { HttpError } from '../http-errors';

/** Both authenticated authoring surfaces use the same generator and the same
 * complete server validation. Only the MCP caller elects to save a reference. */
export async function generateJinchiConfiguration(services: Services, userId: string, request: unknown, options: { title?: string; info?: AuthorInformation } = {}) {
  const parsed = generationSchema.safeParse(request);
  if (!parsed.success) throw new HttpError(422, 'generation_request', 'Проверьте параметры генерации', parsed.error.issues.map(issue => ({ path: `request.${issue.path.join('.')}`, code: issue.code, message: issue.message, severity: 'error' as const })));
  let generated;
  try { generated = generateMap(parsed.data); }
  catch (cause) {
    if (cause instanceof GenerationError) throw new HttpError(422, 'generation_failed', `${cause.message} ${cause.suggestions.join('. ')}`, cause.issues);
    throw cause;
  }
  const sides = parsed.data.dice;
  const checked = await services.configs.validate(userId, {
    sdk: 1, game: 'jinchi', gameVersion: 1, title: options.title ?? `Jinchi: на ${parsed.data.players} игроков`,
    rules: { map: generated.map, dice: { sides: sides[0] === sides[1] ? sides[0] : sides }, flags: generated.flags, effects: generated.effects, end: { maxRounds: 80 } },
    timer: { turnSeconds: 0, onTimeout: 'skip' }, series: {}, visual: {}, ...(options.info ? { info: options.info } : {}),
  });
  if (!checked.ok) throw new HttpError(422, 'invalid_config', 'Сгенерированная карта не прошла проверку', checked.issues);
  return { config: checked.config, summary: checked.summary, issues: checked.issues, diagnostics: generated.diagnostics };
}
