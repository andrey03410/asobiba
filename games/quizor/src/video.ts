import {
  type ConfigDocument,
  type ConfigIssue,
  type GameVideoSupport,
  type VideoDirective,
  type VideoMatchData,
  type VideoSnapshotSummary,
  sliceWindow,
  videoDirective,
} from "@asobiba/sdk";
import type { Block, Field, Question, QuizorRules } from "./rules";

/** Result of a poll field, saved with the question and shown at reveal. */
export interface PollSummary {
  votes: Record<string, number>;
  ranking: string[];
  /** Seats per option (choice) or per first place (order); only with showAnswers. */
  picks?: Record<string, number[]>;
}

/** The part of a Quizor view the video layer reads. */
export interface VideoViewPart {
  phase: string;
  questionId: string | null;
  blocks: Block[];
  blockIndex: number;
  blockStartedAt: number | null;
  reveal: Block[];
  revealIndex?: number;
  revealBlockStartedAt?: number | null;
  players: { seat: number; score: number | null }[];
  history: { questionId: string; poll?: Record<string, PollSummary>; fields: { id: string; type: string; options?: { id: string; card?: string }[]; items?: { id: string; card?: string }[] }[] }[];
  video?: VideoDirective | null;
  videoPreload?: VideoDirective[];
}

export const seatPlayerId = (seat: number) => `seat-${seat}`;

function sceneData(view: VideoViewPart, block: Block): VideoMatchData | null {
  if (block.data === "scores") {
    const players = view.players
      .filter((p) => p.score !== null)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.seat - b.seat);
    return {
      players: players.map((p, i) => ({ id: seatPlayerId(p.seat), name: `Игрок ${p.seat + 1}`, score: p.score ?? 0, rank: i + 1 })),
    };
  }
  if (block.data === "poll") {
    const entry = view.history.find((h) => h.questionId === view.questionId);
    const [fieldId, poll] = Object.entries(entry?.poll ?? {})[0] ?? [];
    if (!poll || !entry) return null;
    const field = entry.fields.find((f) => f.id === fieldId);
    const cards = new Map((field?.options ?? field?.items ?? []).map((o) => [o.id, o.card]));
    const participants: NonNullable<VideoMatchData["participants"]> = {};
    poll.ranking.forEach((optionId, i) => {
      const card = cards.get(optionId);
      if (!card) return;
      participants[card] = {
        votes: poll.votes[optionId] ?? 0,
        rank: i + 1,
        ...(poll.picks ? { pickedBy: (poll.picks[optionId] ?? []).map(seatPlayerId) } : {}),
      };
    });
    return {
      participants,
      players: view.players.map((p) => ({ id: seatPlayerId(p.seat), name: `Игрок ${p.seat + 1}` })),
    };
  }
  return null;
}

function directive(snapshot: string, block: Block, startedAt: number, view: VideoViewPart): VideoDirective | null {
  if (block.type !== "scene" || !block.play) return null;
  return videoDirective({
    snapshot,
    play: block.play,
    startedAt: Math.round(startedAt - (block.startSeconds ?? 0) * 1000),
    start: block.start ? { momentId: block.start } : null,
    hold: block.hold ? { momentId: block.hold } : null,
    data: sceneData(view, block),
  });
}

/**
 * Sets `video` (what plays now) and `videoPreload` (scenes the game will show next and
 * may load early) on a view. A slice ends with the scene of its hold, so a reveal kept in
 * its own scene stays secret until the reveal (see sliceWindow).
 */
export function attachVideo(view: VideoViewPart, rules: QuizorRules, upcoming: Block[]): void {
  view.video = null;
  view.videoPreload = [];
  const snapshot = rules.video?.snapshot;
  if (!snapshot) return;
  if (view.phase === "intro" || view.phase === "show") {
    const block = view.blocks[view.blockIndex];
    if (block && view.blockStartedAt !== null) view.video = directive(snapshot, block, view.blockStartedAt, view);
  } else if (view.phase === "answer" || view.phase === "judging") {
    const block = view.blocks.at(-1);
    // The scene played out before answers opened: frame 0 was (start + length) earlier.
    if (block?.type === "scene" && view.blockStartedAt !== null)
      view.video = directive(snapshot, block, view.blockStartedAt - (block.durationSeconds ?? 0) * 1000, view);
  } else if (view.phase === "reveal") {
    const block = view.reveal[view.revealIndex ?? 0];
    if (block && view.revealBlockStartedAt != null) view.video = directive(snapshot, block, view.revealBlockStartedAt, view);
  }
  view.videoPreload = upcoming.flatMap((block) => {
    const next = block.data === "poll" ? null : directive(snapshot, block, 0, view);
    return next && next.key !== view.video?.key ? [next] : [];
  });
}

// ---- Config checks against snapshot summaries --------------------------------------

function sliceOf(summary: VideoSnapshotSummary, play: NonNullable<Block["play"]>) {
  if ("segmentId" in play) {
    const segment = summary.segments.find((s) => s.id === play.segmentId);
    return segment ? summary.scenes.filter((s) => s.segmentId === play.segmentId) : null;
  }
  const scenes = summary.scenes.filter((s) => play.sceneIds.includes(s.id));
  return scenes.length === new Set(play.sceneIds).size ? scenes : null;
}

type Located = { block: Block; path: string; part: "intro" | "blocks" | "reveal"; question?: Question };

function sceneBlocks(rules: QuizorRules): Located[] {
  const out: Located[] = [];
  const add = (blocks: Block[], path: string, part: Located["part"], question?: Question) =>
    blocks.forEach((block, i) => block.type === "scene" && out.push({ block, path: `${path}[${i}]`, part, question }));
  rules.rounds.forEach((round, r) => {
    add(round.intro, `rules.rounds[${r}].intro`, "intro");
    round.questions.forEach((q, i) => {
      add(q.blocks, `rules.rounds[${r}].questions[${i}].blocks`, "blocks", q);
      add(q.reveal, `rules.rounds[${r}].questions[${i}].reveal`, "reveal", q);
    });
  });
  rules.final.questions.forEach((q, i) => {
    add(q.blocks, `rules.final.questions[${i}].blocks`, "blocks", q);
    add(q.reveal, `rules.final.questions[${i}].reveal`, "reveal", q);
  });
  rules.tiebreak.forEach((q, i) => {
    add(q.blocks, `rules.tiebreak[${i}].blocks`, "blocks", q);
    add(q.reveal, `rules.tiebreak[${i}].reveal`, "reveal", q);
  });
  return out;
}

const cardFields = (q: Question) =>
  q.fields.flatMap((f, i) =>
    f.type === "choice" || f.type === "order"
      ? [{ field: f as Extract<Field, { type: "choice" | "order" }>, index: i }]
      : [],
  );

export function checkQuizorVideo(
  config: ConfigDocument<QuizorRules>,
  snapshots: Record<string, VideoSnapshotSummary>,
): ConfigIssue[] {
  const rules = config.rules;
  const summary = rules.video ? snapshots[rules.video.snapshot] : undefined;
  if (!summary) return [];
  const issues: ConfigIssue[] = [];
  const issue = (path: string, code: string, message: string, hint?: string) =>
    issues.push({ path, code, message, hint, severity: "error" });
  const questionScenes = new Map<Question, VideoSnapshotSummary["scenes"]>();
  // Scenes a question waits in, and where its reveal blocks begin: they must differ.
  const holdScenes = new Map<Question, Set<string>>();
  const revealStarts: { question: Question; scene: string; path: string }[] = [];
  const sceneAt = (scenes: VideoSnapshotSummary["scenes"], frame: number) =>
    scenes.find((s) => s.from <= frame && frame < s.to)?.id;
  for (const { block, path, part, question } of sceneBlocks(rules)) {
    const scenes = sliceOf(summary, block.play!);
    if (!scenes) {
      issue(`${path}.play`, "video_scene", "В снимке нет такого сегмента или сцены", "Сегменты и сцены — в video_snapshot_get");
      continue;
    }
    const moments = new Set(scenes.flatMap((s) => s.holds.map((h) => h.momentId)));
    for (const key of ["start", "hold"] as const) {
      const id = block[key];
      if (id && !moments.has(id)) issue(`${path}.${key}`, "video_moment", `В куске нет момента ${id}`, "Моменты сцен — в video_snapshot_get");
    }
    const uses = new Set(scenes.flatMap((s) => s.uses));
    if (block.data === "poll" && part !== "reveal")
      issue(`${path}.data`, "video_data", "Итоги голосования есть только в раскрытии вопроса", "Перенесите сцену в reveal");
    if (["votes", "rank", "pickedBy"].some((u) => uses.has(u)) && block.data !== "poll")
      issue(`${path}.data`, "video_data", "Сцена показывает голоса и места: нужен data: poll", "Иначе зрители увидят примерные данные ролика");
    if (["players", "score"].some((u) => uses.has(u)) && block.data !== "scores" && block.data !== "poll")
      issue(`${path}.data`, "video_data", "Сцена показывает игроков: нужен data: scores");
    if (block.data === "poll" && question && !question.fields.some((f) => f.settings?.judge === "poll" || rules.defaults.judge === "poll"))
      issue(`${path}.data`, "video_data", "data: poll требует поля с судьёй poll в этом вопросе");
    if (question && part === "blocks") questionScenes.set(question, [...(questionScenes.get(question) ?? []), ...scenes]);
    const window = sliceWindow(scenes, block.start, block.hold);
    if (question && !("missing" in window)) {
      if (part === "blocks" && window.holdFrame !== null) {
        const id = sceneAt(scenes, window.holdFrame);
        if (id) holdScenes.set(question, new Set([...(holdScenes.get(question) ?? []), id]));
      }
      if (part === "reveal" && block.start) {
        const id = sceneAt(scenes, window.startFrame);
        if (id) revealStarts.push({ question, scene: id, path });
      }
    }
  }
  for (const { question, scene, path } of revealStarts)
    if (holdScenes.get(question)?.has(scene))
      issues.push({
        path: `${path}.start`,
        code: "video_reveal_scene",
        message: "Раскрытие начинается в той же сцене, где вопрос ждёт ответа: кадры этой сцены после ожидания игроки получают заранее",
        hint: "Если там ответ, вынесите раскрытие в отдельную сцену douga и начните reveal с неё",
        severity: "warning",
      });
  rules.rounds.forEach((round, r) =>
    round.questions.forEach((q, i) => {
      const scenes = questionScenes.get(q) ?? [];
      const cards = new Set(scenes.flatMap((s) => s.choices.flatMap((c) => [c.cardId, c.participantId].filter(Boolean) as string[])));
      for (const { field, index } of cardFields(q)) {
        const list = field.type === "choice" ? field.options : field.items;
        list.forEach((option, o) => {
          if (!option.card) return;
          if (!scenes.length)
            issue(`rules.rounds[${r}].questions[${i}].fields[${index}]`, "video_card", "card работает, когда в блоках вопроса есть сцена");
          else if (!cards.has(option.card))
            issue(
              `rules.rounds[${r}].questions[${i}].fields[${index}].${field.type === "choice" ? "options" : "items"}[${o}].card`,
              "video_card",
              `В сцене вопроса нет нажимаемой карточки ${option.card}`,
              "Карточки сцен — в video_snapshot_get (choices)",
            );
        });
      }
    }),
  );
  return issues;
}

export const QUIZOR_VIDEO_GUIDE = `## Видео douga
Квиз может играть сцены интерактивного ролика douga. Ролик импортируется в пул
(video_snapshot_import по токену из video_interactive_publish douga), его id \`vsn_…\`
кладётся в \`rules.video.snapshot\`. Устройство снимка — video_snapshot_get: сегменты,
сцены, моменты (holds), нажимаемые карточки (choices) и данные, которые сцене нужны (uses).
- Блок \`{ type: "scene", play: { segmentId } | { sceneIds: [...] }, start?, hold?, data? }\`
  можно класть в intro раунда, blocks и reveal вопроса (не в group).
  - \`hold\` — момент, на котором видео ждёт, пока открыт приём ответов. Последний блок
    вопроса со \`hold\` держит кадр весь вопрос.
  - \`start\` — момент, с которого блок продолжает тот же кусок (обычно в reveal: \`start\` = \`hold\`).
  - Кусок блока кончается сценой его \`hold\`: следующие сцены игроки до раскрытия не получают.
    Всё, что в сцене ожидания идёт после момента, уходит вместе с ней, поэтому ответ держите
    в отдельной сцене (иначе предупреждение video_reveal_scene).
  - \`data\`: \`none\` (по умолчанию), \`scores\` (счёт игроков как players), \`poll\` (итог
    голосования вопроса: votes, rank, pickedBy по \`card\` вариантов; только в reveal).
  - Длительность блока сервер считает по кадрам снимка, durationSeconds задавать не нужно.
- Варианты \`choice\` и элементы \`order\` получают \`card\`: id карточки или участника сцены.
  Нажатие на карточку в кадре — это выбор варианта. \`input\` поля: both | frame | form.
- Судья \`poll\` (settings.judge) — мнения вместо правильных ответов: \`poll.scoring\`
  none (без очков) | majority (очки за выбор большинства) | consensus (близость к общему топу).
  Для \`order\` с poll поле \`correct\` не нужно: общий топ строится суммой мест.
- Свой темп (pacing: self) со сценами несовместим: видео у всех идёт одновременно.
- Два входа: готовый ролик douga → копия с интерактивным слоем; или ролик с нуля по
  интерактивному рецепту douga (recipes ниже).`;

export const quizorVideo: GameVideoSupport<ConfigDocument<QuizorRules>, { video?: VideoDirective | null; videoPreload?: VideoDirective[] }> = {
  contract: 1,
  guide: QUIZOR_VIDEO_GUIDE,
  recipes: [
    "recipe.interactive.quiz-question.*",
    "recipe.interactive.quiz-media.*",
    "recipe.interactive.quiz-reveal.*",
    "recipe.interactive.vote-result.*",
    "recipe.interactive.scoreboard.*",
  ],
  configSnapshots: (config) => (config.rules.video ? [config.rules.video.snapshot] : []),
  directives: (view) => [...(view.video ? [view.video] : []), ...(view.videoPreload ?? [])],
  checkVideo: checkQuizorVideo,
};
