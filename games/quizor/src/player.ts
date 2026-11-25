import { PlayerHandles } from "@asobiba/sdk";
import { decodeQuizorAction, encodeQuizorIds } from "./player-ids";
import { blockProgress, visibleBlockText } from "./block-presentation";
import { blockDuration, type Block } from "./rules";
import type { PlayerActionForm } from "@asobiba/sdk";
import type { PublicField, QuizorView } from "./game";

function answerInput(field: PublicField): Record<string, unknown> {
  const ids = (items?: { id: string }[]) => (items ?? []).map(item => item.id);
  switch (field.type) {
    case "text": return { type: "string", maxLength: field.maxLength };
    case "number": return { type: "number", minimum: field.min, maximum: field.max };
    case "oral": return { const: true, description: "Подтвердить устный ответ" };
    case "choice": return field.pick === "frame"
      ? { type: "string", description: "Получите текущий кадр через agent_media и выберите handle видимой области." }
      : { enum: ids(field.options) };
    case "multi": return { type: "array", items: { enum: ids(field.options) }, uniqueItems: true, maxItems: field.maxSelected };
    case "order": return { type: "array", items: { enum: ids(field.items) }, uniqueItems: true, minItems: field.items?.length, maxItems: field.items?.length };
    case "list": return { type: "array", items: { type: "string" }, maxItems: field.maxItems };
    case "match": return { type: "object", properties: Object.fromEntries(ids(field.left).map(id => [id, { enum: ids(field.right) }])), additionalProperties: false };
    case "point": {
      const fraction = { type: "number", minimum: 0, maximum: 1 };
      return { type: "object", properties: { x: fraction, y: fraction }, required: ["x", "y"] };
    }
  }
}

/** Only legal hints and data a player sees can contribute to the command forms. */
export function quizorPlayerActions(view: QuizorView, seat: number): PlayerActionForm[] {
  if (view.seat !== seat) return [];
  return view.legal.flatMap((type): PlayerActionForm[] => {
    switch (type) {
      case "answer":
      case "draft": return [{ type, fields: { questionId: view.questionId, answers: { type: "object",
        properties: Object.fromEntries(view.fields.map(f => [f.id, answerInput(f)])),
        required: type === "answer" ? view.fields.filter(f => f.required && f.type !== "oral").map(f => f.id) : [],
        additionalProperties: false } } }];
      case "ready": return [{ type, fields: { phase: view.phase, questionId: view.questionId } }];
      case "select": return view.board.filter(cell => !cell.played).map(cell => ({ type, fields: { questionId: cell.questionId } }));
      case "ban": return view.themes.map(theme => ({ type, fields: { questionId: theme.questionId } }));
      case "transfer": return view.players.filter(player => !player.out && (view.special?.allowSelf || player.seat !== seat))
        .map(player => ({ type, fields: { seat: player.seat } }));
      case "bid": {
        const choices = view.special?.type === "transfer" ? view.special.values : undefined;
        const amount = choices?.length ? { enum: choices } : { type: "number", minimum: view.special?.minimum ?? 0 };
        return [{ type, fields: { amount } }, ...(view.special?.type === "auction" ? [{ type, fields: { amount, allIn: true } }] : [])];
      }
      case "self-grade": return view.judging.filter(j => j.seat === seat && j.judge === "self").flatMap(j =>
        (j.grades ?? view.grades).map(grade => ({ type, fields: { fieldId: j.fieldId, grade: grade.id } })));
      case "vote": return view.judging.filter(j => j.seat !== seat && (j.judge === "vote" || j.judge === "best")).map(j =>
        ({ type, fields: { seat: j.seat, fieldId: j.fieldId, accept: j.judge === "best" ? true : { type: "boolean" } } }));
      case "appeal": return view.history.filter(h => h.disclosed).flatMap(h => h.answers.map(a =>
        ({ type, fields: { questionId: h.questionId, seat: a.seat, points: { type: "number" }, comment: { type: "string", maxLength: 500 } } })));
      case "appeal-vote": return [{ type, fields: { accept: { type: "boolean" } } }];
      case "buzz":
      case "pass":
      case "hurry":
      case "next-block": return [{ type }];
      default: return [];
    }
  });
}

function presentedBlock(block: Block, startedAt: number, now: number, playedMs: number, imageStartedAt: number): Block {
  if (block.type === "scene") return { type: "scene", durationSeconds: block.durationSeconds };
  const progress = blockProgress(block, now, startedAt);
  if (block.type === "group") return { ...block, blocks: block.blocks?.map(child => presentedBlock(child, startedAt, now, playedMs, imageStartedAt)) };
  if (block.type === "text") return { ...block, text: visibleBlockText(block, progress) };
  if (block.type === "image") return { ...block, playerImageStartedAt: imageStartedAt,
    ...(block.effect && block.effect !== "none" && { playerProgress: Math.floor(progress * 100) / 100 }) };
  if (block.type === "audio" || block.type === "video") {
    const elapsed = Math.min(playedMs, (block.durationSeconds ?? Infinity) * 1000);
    return { ...block, playerElapsedSeconds: Math.max(0, Math.floor(elapsed / 100) / 10) };
  }
  return block;
}

function presentedBlocks(blocks: Block[], index: number, startedAt: number, now: number, completed: number[] = []): Block[] {
  let offset = startedAt - blocks.slice(0, index).reduce((total, block) => total + blockDuration(block), 0);
  let imageStartedAt = startedAt - completed.slice(0, index).reduce((total, ms) => total + (ms ?? 0), 0);
  return blocks.map((block, i) => {
    // Text effects follow the board's timeline. Playback stops immediately when another block takes focus.
    const playedMs = i === index ? now - startedAt : completed[i] ?? 0;
    const visible = presentedBlock(block, offset, now, playedMs, imageStartedAt);
    offset += blockDuration(block);
    imageStartedAt += completed[i] ?? 0;
    return visible;
  });
}

export function quizorPlayerView(view: QuizorView, _seat: number, gameTime = view.serverNow, handles = new PlayerHandles()): QuizorView {
  // Browser caches may contain future files. History renders the prompt, reference, answers and corrections only.
  const { preload, videoPreload, presenterNotes, agentTask, playedBlockMs, playedRevealMs, ...visible } = view;
  const now = view.paused ? view.serverNow : gameTime;
  return encodeQuizorIds({
    ...visible, controls: [], board: view.phase === "board" ? view.board : [],
    blocks: presentedBlocks(view.blocks, view.blockIndex, view.blockStartedAt ?? now, now, playedBlockMs),
    reveal: presentedBlocks(view.reveal, view.revealIndex ?? 0, view.revealBlockStartedAt ?? view.revealStartedAt ?? view.serverNow, now, playedRevealMs),
    history: view.history.map(h => ({ ...h, blocks: [], fields: [], reveal: [] })),
    fields: (view.phase === "answer" || view.phase === "show") && (view.canAnswer || view.ownAnswer !== null) ? view.fields : [],
  }, view, handles);
}

/** Scene selection and cue IDs are server rendering details. The MCP client requests the current fragment by key. */
export function quizorPlayerWireView(view: QuizorView): unknown {
  let appeal = null;
  if (view.appeal) {
    const { votes, ...details } = view.appeal;
    appeal = { ...details, voteCount: Object.keys(votes).length, ownVote: votes[String(view.seat)] ?? null };
  }
  const fields = view.fields.map(field => {
    if (field.pick === "frame") return { ...field, options: [] };
    const options = field.options?.map(({ card, ...option }) => option);
    const items = field.items?.map(({ card, ...item }) => item);
    const left = field.left?.map(({ id, text, asset, media }) => ({ id, text, asset, media }));
    const right = field.right?.map(({ id, text, asset, media }) => ({ id, text, asset, media }));
    return { ...field, ...(options && { options }), ...(items && { items }), ...(left && { left }), ...(right && { right }) };
  });
  return { ...view, fields, appeal, video: view.video ? { key: view.video.key, startedAt: view.video.startedAt } : null };
}

export function prepareQuizorPlayerAction(action: unknown, view: QuizorView, gameTime: number, handles: PlayerHandles): unknown {
  if (typeof action !== "object" || !action || Array.isArray(action)) return null;
  if (!("type" in action) || action.type !== "buzz") return decodeQuizorAction(action as Record<string, unknown>, view, handles);
  const elapsed = view.answerOpenedAt === null || view.answerOpenedAt === undefined ? 0 : gameTime - view.answerOpenedAt;
  return { ...action, reactionMs: Math.min(86_400_000, Math.max(0, elapsed)) };
}
