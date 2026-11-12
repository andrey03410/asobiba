import type { BoardProps, SeatIconProps } from "@asobiba/sdk";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import type { QuizorView } from "../game";
import { blockDuration } from "../rules";
import { resolveVisual } from "../visual";
import { AnswerForm, initialAnswers, type FormAnswers } from "./AnswerForm";
import { Blocks } from "./Blocks";
import { ScoreStrip, SEAT_COLORS } from "./ScoreStrip";
import { StaticBoard } from "./StaticBoard";
import { Preloader } from "./Preloader";

const phaseLabel: Record<string, string> = {
  intro: "Новый раунд",
  board: "Выбор вопроса",
  special: "Особый вопрос",
  preload: "Готовим вопрос",
  show: "Внимание на экран",
  answer: "Приём ответов",
  judging: "Проверка ответов",
  reveal: "Правильный ответ",
  "round-reveal": "Разбор раунда",
  "final-ban": "Финал · отсев тем",
  done: "Итоги",
};
const answerText = (value: unknown): string =>
  value === null
    ? "—"
    : typeof value === "object"
      ? Array.isArray(value)
        ? value.join(", ")
        : Object.entries(value as Record<string, unknown>)
            .map(([k, v]) => `${k}: ${v}`)
            .join(" · ")
      : String(value);
function preference(key: string, fallback: boolean): boolean {
  try {
    return typeof localStorage === "undefined"
      ? fallback
      : localStorage.getItem(`quizor.${key}`) === null
        ? fallback
        : localStorage.getItem(`quizor.${key}`) === "true";
  } catch {
    return fallback;
  }
}

function QuestionAnswer({
  view,
  assetUrl,
  act,
  cached,
  onDraft,
}: {
  view: QuizorView;
  assetUrl: BoardProps["assetUrl"];
  act: (action: unknown) => void;
  cached?: FormAnswers;
  onDraft(value: FormAnswers): void;
}) {
  const [value, setValue] = useState<FormAnswers>(() => ({
    ...initialAnswers(view.fields),
    ...view.ownAnswer,
    ...cached,
  }));
  const [sent, setSent] = useState(false);
  const draft = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    setSent(false);
  }, [view.ownAnswer]);
  useEffect(
    () => () => {
      if (draft.current) clearTimeout(draft.current);
    },
    [],
  );
  const change = (next: FormAnswers) => {
    setValue(next);
    onDraft(next);
    if (draft.current) clearTimeout(draft.current);
    draft.current = setTimeout(() => {
      act({ type: "draft", answers: next });
      draft.current = null;
    }, 200);
  };
  return (
    <AnswerForm
      fields={view.fields}
      value={value}
      onChange={change}
      assetUrl={assetUrl}
      disabled={!view.canAnswer || sent}
      submitted={view.submitted.includes(view.seat ?? -1)}
      onSubmit={(answers) => {
        if (draft.current) clearTimeout(draft.current);
        draft.current = null;
        setSent(true);
        act({ type: "answer", answers });
        // A refused action is reported by the site; allow a retry after a lost acknowledgement.
        setTimeout(() => setSent(false), 1500);
      }}
    />
  );
}

function PresenterPanel({
  view,
  names,
  control,
  role,
}: {
  view: QuizorView;
  names: string[];
  control: (a: unknown) => void;
  role: "host" | "presenter";
}) {
  const [seat, setSeat] = useState(0);
  const [delta, setDelta] = useState("0");
  const [reason, setReason] = useState("");
  const [grade, setGrade] = useState("correct");
  const commands: [string, string][] = [
    ["next-block", "Следующий блок"],
    ["open", "Открыть ответы"],
    ["close", "Закрыть вопрос"],
    ["next", "Дальше"],
    ["skip", "Пропустить вопрос"],
    ["award-all", "Засчитать всем"],
  ];
  return (
    <details className="qz-presenter" open={role === "presenter"}>
      <summary>
        {role === "presenter" ? "Пульт ведущего" : "Управление хозяина"}
      </summary>
      <div className="qz-control-buttons">
        <button
          type="button"
          disabled={Boolean(view.resumeAt)}
          onClick={() => control({ type: view.paused ? "resume" : "pause" })}
        >
          {view.paused ? "Продолжить" : "Пауза"}
        </button>
        {commands
          .filter(([key]) => view.controls.includes(key))
          .map(([key, label]) => (
            <button
              type="button"
              key={key}
              onClick={() => control({ type: key })}
            >
              {label}
            </button>
          ))}
        {role === "presenter" && (
          <>
            <button
              type="button"
              onClick={() => control({ type: "extend-timer", seconds: 30 })}
            >
              +30 секунд
            </button>
            <button
              type="button"
              onClick={() => control({ type: "extend-timer", seconds: 0 })}
            >
              Остановить таймер
            </button>
            <button
              type="button"
              onClick={() => control({ type: "finish-round" })}
            >
              Завершить раунд
            </button>
          </>
        )}
      </div>
      {role === "presenter" && (
        <>
          <details className="qz-author">
            <summary>Эталон и примечания</summary>
            <p>{view.reference}</p>
            {view.presenterNotes?.map((note, i) => (
              <p key={i}>{note}</p>
            ))}
            {view.answers.map((a) => (
              <p key={a.seat}>
                <b>{names[a.seat] ?? `Игрок ${a.seat + 1}`}</b>:{" "}
                {Object.values(a.answers).map(answerText).join(" · ")}
              </p>
            ))}
          </details>
          <div className="qz-judging">
            {view.judging.map((item) => (
              <div key={`${item.seat}:${item.fieldId}`}>
                <b>
                  {names[item.seat] ?? `Игрок ${item.seat + 1}`} ·{" "}
                  {item.fieldId}
                </b>
                <span>
                  {answerText(
                    view.answers.find((a) => a.seat === item.seat)?.answers[
                      item.fieldId
                    ],
                  )}
                </span>
                {(item.grades ?? view.grades).map((g) => (
                  <button
                    type="button"
                    key={g.id}
                    onClick={() =>
                      control({
                        type: "grade",
                        seat: item.seat,
                        fieldId: item.fieldId,
                        grade: g.id,
                      })
                    }
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const n = Number(delta);
              if (Number.isFinite(n))
                control({ type: "adjust-score", seat, delta: n, reason });
            }}
            className="qz-adjust"
          >
            <label>
              Игрок
              <select
                value={seat}
                onChange={(e) => setSeat(Number(e.target.value))}
              >
                {view.players.map((p) => (
                  <option key={p.seat} value={p.seat}>
                    {names[p.seat] ?? `Игрок ${p.seat + 1}`}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Изменение очков
              <input
                type="number"
                value={delta}
                onChange={(e) => setDelta(e.target.value)}
                required
              />
            </label>
            <label>
              Причина
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
              />
            </label>
            <button type="submit">Изменить счёт</button>
          </form>
          <div className="qz-control-buttons">
            <label>
              Назначить игрока
              <select
                value={seat}
                onChange={(e) => setSeat(Number(e.target.value))}
              >
                {view.players.map((p) => (
                  <option key={p.seat} value={p.seat}>
                    {names[p.seat] ?? `Игрок ${p.seat + 1}`}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => control({ type: "assign", seat })}
            >
              Назначить
            </button>
            <label>
              Оценка
              <select value={grade} onChange={(e) => setGrade(e.target.value)}>
                {view.grades.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => control({ type: "grade", seat, grade })}
            >
              Оценить ответ
            </button>
          </div>
        </>
      )}
    </details>
  );
}

function AppealPanel({
  view,
  me,
  names,
  act,
}: {
  view: QuizorView;
  me: number | null;
  names: string[];
  act: (a: unknown) => void;
}) {
  const [opened, setOpened] = useState(false);
  const [seat, setSeat] = useState(me ?? 0);
  const [question, setQuestion] = useState("");
  const [points, setPoints] = useState("100");
  const [comment, setComment] = useState("");
  const history = view.history.filter((h) => h.disclosed);
  const qid = question || history.at(-1)?.questionId || "";
  const record = history.find((h) => h.questionId === qid);
  const entry = record?.answers.find((a) => a.seat === seat);
  const appeal = view.appeal;
  return (
    <>
      {appeal && (
        <aside className="qz-appeal-vote" aria-label="Голосование по апелляции">
          <b>Апелляция · {names[appeal.seat] ?? `Игрок ${appeal.seat + 1}`}</b>
          <p>
            {appeal.points} вместо {appeal.previous} за вопрос ·{" "}
            {appeal.comment}
          </p>
          <p className="qz-muted">
            Голосов: {Object.keys(appeal.votes).length}
          </p>
          {me !== null &&
            me !== appeal.seat &&
            appeal.votes[String(me)] === undefined && (
              <div className="qz-control-buttons">
                <button
                  type="button"
                  onClick={() => act({ type: "appeal-vote", accept: true })}
                >
                  Согласен
                </button>
                <button
                  type="button"
                  onClick={() => act({ type: "appeal-vote", accept: false })}
                >
                  Не согласен
                </button>
              </div>
            )}
        </aside>
      )}
      {view.legal.includes("appeal") && (
        <button
          type="button"
          className="qz-appeal-button"
          onClick={() => setOpened((x) => !x)}
        >
          Апелляция
        </button>
      )}
      {opened && !appeal && (
        <form
          className="qz-appeal-form"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            const n = Number(points);
            if (qid && Number.isFinite(n)) {
              act({
                type: "appeal",
                questionId: qid,
                seat,
                points: n,
                comment,
              });
              setOpened(false);
            }
          }}
        >
          <h3>Оспорить очки за вопрос</h3>
          <label>
            Вопрос
            <select value={qid} onChange={(e) => setQuestion(e.target.value)}>
              {history.map((h) => (
                <option key={h.questionId} value={h.questionId}>
                  {h.prompt}
                </option>
              ))}
            </select>
          </label>
          <label>
            Игрок
            <select
              value={seat}
              onChange={(e) => setSeat(Number(e.target.value))}
            >
              {view.players.map((p) => (
                <option key={p.seat} value={p.seat}>
                  {names[p.seat] ?? `Игрок ${p.seat + 1}`}
                </option>
              ))}
            </select>
          </label>
          <p>
            Ответ:{" "}
            {entry
              ? Object.values(entry.answers).map(answerText).join(" · ")
              : "—"}
          </p>
          <p>
            Эталон: {record?.reference ?? "—"} · Сейчас: {entry?.points ?? 0}
          </p>
          <label>
            Должен получить
            <input
              type="number"
              value={points}
              onChange={(e) => setPoints(e.target.value)}
              required
            />
          </label>
          <label>
            Комментарий
            <input
              maxLength={500}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </label>
          <div className="qz-control-buttons">
            <button className="qz-primary" type="submit">
              На голосование
            </button>
            <button type="button" onClick={() => setOpened(false)}>
              Отмена
            </button>
          </div>
        </form>
      )}
    </>
  );
}

export function QuizorBoard(props: BoardProps) {
  const {
    match,
    config,
    seat,
    assetUrl,
    onAction,
    onControl,
    controlRole,
    playerNames = [],
    clockOffset = 0,
  } = props;
  const view = match.game as QuizorView;
  const [clock, setClock] = useState(() => Date.now());
  const [muted, setMuted] = useState(() => preference("muted", true));
  const [compact, setCompact] = useState(() => preference("compact", false));
  const [bid, setBid] = useState("0");
  const [target, setTarget] = useState(seat ?? 0);
  const draftCache = useRef(new Map<string, FormAnswers>());
  const lastMatchPhase = useRef(match.phase);
  if (lastMatchPhase.current === "finished" && match.phase !== "finished")
    draftCache.current.clear();
  lastMatchPhase.current = match.phase;
  useEffect(() => {
    if (props.staticRender) return;
    const timer = setInterval(() => setClock(Date.now()), 100);
    return () => clearInterval(timer);
  }, [props.staticRender]);
  useEffect(() => {
    setBid(String(view.special?.values[0] ?? view.special?.minimum ?? 0));
    setTarget(seat ?? 0);
  }, [view.questionId, seat]);
  useEffect(() => {
    try {
      localStorage.setItem("quizor.muted", String(muted));
      localStorage.setItem("quizor.compact", String(compact));
    } catch {
      /* local preferences are optional */
    }
  }, [muted, compact]);
  const buzzStart = useRef(0);
  const canBuzz = Boolean(onAction) && view.legal.includes("buzz");
  useEffect(() => {
    if (canBuzz) buzzStart.current = Date.now();
  }, [canBuzz, view.questionId, view.answerOpenedAt]);
  if (props.staticRender) return <StaticBoard {...props} />;
  const visual = resolveVisual(view.roundVisual ?? (config.visual as never));
  const now = clock + clockOffset;
  const frozen = view.paused || (view.resumeAt !== null && now < view.resumeAt);
  const shownNow = frozen ? view.serverNow : now;
  const act = (a: unknown) => onAction?.(a);
  const name = (s: number) => playerNames[s] ?? `Игрок ${s + 1}`;
  const legal = (key: string) => Boolean(onAction) && view.legal.includes(key);
  const recipients = view.players.filter(
    (p) => !p.out && (view.special?.allowSelf || p.seat !== seat),
  );
  const selectedTarget = recipients.some((p) => p.seat === target)
    ? target
    : (recipients[0]?.seat ?? target);
  const control = (a: unknown) => onControl?.(a);
  const left =
    view.deadline === null
      ? null
      : Math.max(0, Math.ceil((view.deadline - shownNow) / 1000));
  const styles = {
    "--qz-bg": visual.background,
    "--qz-surface": visual.surface,
    "--qz-text": visual.foreground,
    "--qz-muted": visual.muted,
    "--qz-accent": visual.accent,
    "--qz-positive": visual.positive,
    "--qz-negative": visual.negative,
    "--qz-duration": `${visual.animations.durationMs}ms`,
    "--qz-motion": visual.animations.intensity,
    ...(visual.backgroundAsset
      ? {
          backgroundImage: `linear-gradient(130deg,${visual.background}dd,${visual.background}ee),url(${assetUrl(visual.backgroundAsset)})`,
        }
      : {}),
  } as CSSProperties;
  return (
    <section
      className={`qz${props.stage ? " qz-stage" : ""}${frozen ? " is-paused" : ""}${visual.animations?.enabled === false ? " qz-no-motion" : ""}`}
      style={styles}
      aria-label="Quizor"
    >
      <header className="qz-header">
        <div>
          <span className="qz-brand">QUIZOR</span>
          <h2>{view.title || config.title}</h2>
          <p>
            {phaseLabel[view.phase]}
            {view.questionNumber > 0 &&
              ` · ${view.questionNumber}/${view.questionCount}`}
          </p>
        </div>
        <div className="qz-tools">
          {left !== null && (
            <span
              className={`qz-timer${left <= 5 ? " is-low" : ""}`}
              aria-label={`Осталось ${left} секунд`}
            >
              <svg viewBox="0 0 40 40" aria-hidden="true">
                <circle cx="20" cy="20" r="17" />
              </svg>
              <b>{left}</b>
            </span>
          )}
          <button
            type="button"
            aria-pressed={!muted}
            onClick={() => setMuted((x) => !x)}
          >
            {muted ? "Включить звук" : "Без звука"}
          </button>
          <button
            type="button"
            aria-pressed={compact}
            onClick={() => setCompact((x) => !x)}
          >
            {compact ? "Полный вид" : "Компактно"}
          </button>
          {props.fullscreen?.available && (
            <button
              type="button"
              aria-label="Полный экран Quizor"
              onClick={props.fullscreen.toggle}
            >
              ⛶
            </button>
          )}
        </div>
      </header>
      <div className="qz-scroll">
        {frozen ? (
          <div className="qz-pause-screen">
            <span>Ⅱ</span>
            <h2>
              {view.resumeAt
                ? Math.max(1, Math.ceil((view.resumeAt - now) / 1000))
                : "Пауза"}
            </h2>
            <p>Продолжим вместе</p>
          </div>
        ) : (
          <div
            className="qz-scene"
            key={`${view.roundId}:${view.phase === "board" ? "board" : (view.questionId ?? view.phase)}`}
          >
            {view.phase === "intro" && (
              <div className="qz-intro">
                <span className="qz-kicker">Раунд {view.round}</span>
                <h1>{view.title}</h1>
                <p>{view.questionCount} вопросов · отвечайте в своём ритме</p>
              </div>
            )}
            {view.phase === "preload" && (
              <div className="qz-intro">
                <Preloader
                  key={view.questionId}
                  files={view.preload ?? []}
                  assetUrl={assetUrl}
                  onReady={
                    onAction
                      ? () =>
                          act({
                            type: "ready",
                            questionId: view.questionId,
                            phase: "preload",
                          })
                      : undefined
                  }
                />
                <span className="qz-loading" />
                <h2>Готовим вопрос</h2>
                <p>Медиа загружается перед общим стартом</p>
              </div>
            )}
            {view.phase === "board" && (
              <div className="qz-board" aria-label="Табло">
                <p className="qz-board-note">Выбирает {name(view.chooser)}</p>
                <div className="qz-board-columns">
                  {[...new Set(view.board.map((c) => c.theme))].map((theme) => (
                    <section key={theme}>
                      <h3>{theme}</h3>
                      {view.board
                        .filter((c) => c.theme === theme)
                        .map((c) => (
                          <button
                            type="button"
                            key={c.questionId}
                            disabled={
                              c.played ||
                              !(legal("select") || controlRole === "presenter")
                            }
                            aria-label={`${theme}, ${c.value}${c.played ? ", сыграно" : ""}`}
                            onClick={() =>
                              controlRole === "presenter"
                                ? control({
                                    type: "select",
                                    questionId: c.questionId,
                                  })
                                : act({
                                    type: "select",
                                    questionId: c.questionId,
                                  })
                            }
                          >
                            {c.played ? (
                              "—"
                            ) : (
                              <>
                                {c.value}
                                {c.special && <small>{c.special}</small>}
                              </>
                            )}
                          </button>
                        ))}
                    </section>
                  ))}
                </div>
              </div>
            )}
            {view.phase === "final-ban" && (
              <div className="qz-final">
                <span className="qz-kicker">Финал</span>
                <h1>Какая тема останется?</h1>
                <p>Убирает {name(view.chooser)}</p>
                <div className="qz-options">
                  {view.themes.map((t) => (
                    <button
                      type="button"
                      key={t.questionId}
                      disabled={!legal("ban")}
                      onClick={() =>
                        act({ type: "ban", questionId: t.questionId })
                      }
                    >
                      {t.theme}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {view.phase === "special" && view.special && (
              <div className="qz-special">
                <span className="qz-kicker">
                  {
                    (
                      {
                        transfer: "Передача",
                        auction: "Аукцион",
                        "wager-all": "Ставка всех",
                        wager: "Ставка",
                        "risk-free": "Без риска",
                        gift: "Подарок",
                      } as Record<string, string>
                    )[view.special.type]
                  }
                </span>
                <h1>{view.special.topic}</h1>
                {legal("transfer") && (
                  <div className="qz-control-buttons">
                    <label>
                      Кому вопрос
                      <select
                        value={target}
                        onChange={(e) => setTarget(Number(e.target.value))}
                      >
                        {view.players
                          .filter(
                            (p) =>
                              !p.out &&
                              (view.special!.allowSelf || p.seat !== seat),
                          )
                          .map((p) => (
                            <option key={p.seat} value={p.seat}>
                              {name(p.seat)}
                            </option>
                          ))}
                      </select>
                    </label>
                    {view.special.values.length > 0 && (
                      <span className="qz-muted">
                        Стоимость выберет получатель
                      </span>
                    )}
                    <button
                      className="qz-primary"
                      type="button"
                      onClick={() =>
                        act({ type: "transfer", seat: selectedTarget })
                      }
                    >
                      Передать
                    </button>
                  </div>
                )}
                {legal("bid") && (
                  <form
                    className="qz-bid"
                    onSubmit={(e) => {
                      e.preventDefault();
                      act({ type: "bid", amount: Number(bid) });
                    }}
                  >
                    <label>
                      {view.special.type === "transfer"
                        ? "Стоимость вопроса"
                        : "Ваша ставка"}
                      {view.special.type === "transfer" ? (
                        <select
                          value={bid}
                          onChange={(e) => setBid(e.target.value)}
                        >
                          {view.special.values.map((x) => (
                            <option key={x} value={x}>
                              {x}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="number"
                          min={view.special.minimum}
                          value={bid}
                          onChange={(e) => setBid(e.target.value)}
                          required
                        />
                      )}
                    </label>
                    <button className="qz-primary" type="submit">
                      Поставить
                    </button>
                    {view.special.type === "auction" && (
                      <button
                        type="button"
                        onClick={() =>
                          act({
                            type: "bid",
                            amount: Math.max(
                              view.special!.minimum,
                              view.players.find((p) => p.seat === seat)
                                ?.score ?? 0,
                            ),
                            allIn: true,
                          })
                        }
                      >
                        Ва-банк
                      </button>
                    )}
                  </form>
                )}
                {Object.entries(view.bids).length > 0 && (
                  <ul>
                    {Object.entries(view.bids).map(([s, amount]) => (
                      <li key={s}>
                        {name(Number(s))}: {amount}
                      </li>
                    ))}
                  </ul>
                )}
                {view.bidTurn !== null && <p>Сейчас {name(view.bidTurn)}</p>}
              </div>
            )}
            {view.blocks.length > 0 && (
              <Blocks
                blocks={view.blocks}
                assetUrl={assetUrl}
                startedAt={
                  (view.blockStartedAt ?? shownNow) -
                  view.blocks
                    .slice(0, view.blockIndex)
                    .reduce((sum, b) => sum + blockDuration(b), 0)
                }
                now={shownNow}
                activeIndex={view.blockIndex}
                compact={compact}
                muted={muted}
                paused={frozen}
                onReady={() => {
                  if (view.phase === "preload") act({ type: "ready" });
                }}
              />
            )}
            {view.prompt && <h1 className="qz-prompt">{view.prompt}</h1>}
            {legal("buzz") && (
              <button
                type="button"
                className="qz-buzzer"
                onClick={() =>
                  act({
                    type: "buzz",
                    reactionMs: Math.max(0, Date.now() - buzzStart.current),
                  })
                }
              >
                Ответить первым
              </button>
            )}
            {view.answering !== null && view.phase === "answer" && (
              <p className="qz-answering">Отвечает {name(view.answering)}</p>
            )}
            {onAction &&
              (view.phase === "answer" || view.phase === "show") &&
              view.fields.length > 0 &&
              (view.canAnswer || view.ownAnswer !== null) && (
                <QuestionAnswer
                  key={view.questionId}
                  view={view}
                  assetUrl={assetUrl}
                  act={act}
                  cached={draftCache.current.get(view.questionId ?? "")}
                  onDraft={(answers) =>
                    draftCache.current.set(view.questionId ?? "", answers)
                  }
                />
              )}
            {(view.phase === "answer" || view.phase === "show") &&
              seat !== null &&
              view.submitted.includes(seat) &&
              !view.canAnswer && (
                <p className="qz-submitted" role="status">
                  ✓ Ответ принят. Ждём остальных.
                </p>
              )}
            {view.selfReference && (
              <div className="qz-reference">
                <p>{view.selfReference}</p>
                {view.judging
                  .filter((j) => j.judge === "self" && j.seat === seat)
                  .map((j) => (
                    <div key={j.fieldId}>
                      <b>{j.fieldId}</b>
                      {(j.grades ?? view.grades).map((g) => (
                        <button
                          type="button"
                          key={g.id}
                          onClick={() =>
                            act({
                              type: "self-grade",
                              fieldId: j.fieldId,
                              grade: g.id,
                            })
                          }
                        >
                          {g.label}
                        </button>
                      ))}
                    </div>
                  ))}
              </div>
            )}
            {view.phase === "judging" &&
              view.judging
                .filter((j) => j.judge === "vote" || j.judge === "best")
                .map((j) => (
                  <div key={`${j.seat}:${j.fieldId}`} className="qz-vote">
                    <b>
                      {name(j.seat)} · {j.fieldId}
                    </b>
                    <p>
                      {answerText(
                        view.answers.find((a) => a.seat === j.seat)?.answers[
                          j.fieldId
                        ],
                      )}
                    </p>
                    {seat !== j.seat && legal("vote") && (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            act({
                              type: "vote",
                              seat: j.seat,
                              fieldId: j.fieldId,
                              accept: true,
                            })
                          }
                        >
                          Засчитать
                        </button>
                        {j.judge !== "best" && (
                          <button
                            type="button"
                            onClick={() =>
                              act({
                                type: "vote",
                                seat: j.seat,
                                fieldId: j.fieldId,
                                accept: false,
                              })
                            }
                          >
                            Не засчитать
                          </button>
                        )}
                      </>
                    )}
                  </div>
                ))}
            {(view.phase === "reveal" ||
              view.phase === "round-reveal" ||
              view.phase === "done") && (
              <div className="qz-reveal">
                {view.reference && (
                  <div className="qz-reference">
                    <span>Правильный ответ</span>
                    <h2>{view.reference}</h2>
                  </div>
                )}
                {view.reveal.length > 0 && (
                  <Blocks
                    blocks={view.reveal}
                    assetUrl={assetUrl}
                    now={shownNow}
                    startedAt={
                      (view.revealBlockStartedAt ??
                        view.revealStartedAt ??
                        view.serverNow) -
                      view.reveal
                        .slice(0, view.revealIndex ?? 0)
                        .reduce((sum, b) => sum + blockDuration(b), 0)
                    }
                    activeIndex={view.revealIndex}
                    muted={muted}
                    paused={frozen}
                    compact={compact}
                  />
                )}
                <div className="qz-answers">
                  {view.answers.map((a) => (
                    <article
                      className={`qz-revealed-answer${a.points < 0 ? " is-negative" : a.correct ? " is-correct" : ""}`}
                      key={a.seat}
                    >
                      <header>
                        <b>{name(a.seat)}</b>
                        <strong>
                          {a.points > 0 ? "+" : ""}
                          {a.points}
                        </strong>
                      </header>
                      <p>
                        {Object.values(a.answers).map(answerText).join(" · ")}
                      </p>
                      <span>{a.label}</span>
                      <small>{a.explanation}</small>
                    </article>
                  ))}
                </div>
              </div>
            )}
            {view.phase === "done" && (
              <div className="qz-podium">
                <span className="qz-kicker">Квиз пройден</span>
                <h1>
                  {view.result?.winners.map(name).join(" · ") ||
                    "Спасибо за игру"}
                </h1>
                <p>Каждый вопрос — новая история</p>
              </div>
            )}
            <div className="qz-player-actions">
              {legal("ready") && (
                <button
                  className="qz-primary"
                  type="button"
                  onClick={() =>
                    act({
                      type: "ready",
                      questionId: view.questionId,
                      phase: view.phase,
                    })
                  }
                >
                  {view.phase === "intro"
                    ? "Начать раунд"
                    : view.phase === "preload"
                      ? "Готов к старту"
                      : "Готов дальше"}
                </button>
              )}
              {legal("next-block") && (
                <button
                  type="button"
                  onClick={() => act({ type: "next-block" })}
                >
                  Следующий блок
                </button>
              )}
              {legal("hurry") && (
                <button type="button" onClick={() => act({ type: "hurry" })}>
                  Поторопить
                </button>
              )}
              {legal("pass") && (
                <button type="button" onClick={() => act({ type: "pass" })}>
                  Пас
                </button>
              )}
            </div>
            {view.history.length > 0 && (
              <details className="qz-history">
                <summary>
                  Разбор · {view.history.filter((h) => h.disclosed).length}
                </summary>
                {view.history
                  .filter((h) => h.disclosed)
                  .map((h) => (
                    <article key={h.questionId}>
                      <h3>{h.prompt}</h3>
                      <p>{h.reference}</p>
                      {h.answers.map((a) => (
                        <p key={a.seat}>
                          <b>{name(a.seat)}</b>:{" "}
                          {Object.values(a.answers).map(answerText).join(" · ")}{" "}
                          · {a.points}
                        </p>
                      ))}
                      {h.corrections.map((c, i) => (
                        <small key={i}>{c}</small>
                      ))}
                    </article>
                  ))}
              </details>
            )}
          </div>
        )}
        {onControl && controlRole && (
          <PresenterPanel
            view={view}
            names={playerNames}
            role={controlRole}
            control={control}
          />
        )}
        {view.events.length > 0 && (
          <details className="qz-events">
            <summary>События</summary>
            <ol>
              {view.events.slice(-30).map((e) => (
                <li key={e.id}>{e.text}</li>
              ))}
            </ol>
          </details>
        )}
      </div>
      <ScoreStrip
        players={view.players}
        names={playerNames}
        me={seat}
        colors={visual.seatColors ?? SEAT_COLORS}
        durationMs={
          visual.animations.enabled && visual.animations.intensity > 0
            ? visual.animations.durationMs
            : 0
        }
      />
      {onAction && (
        <AppealPanel view={view} names={playerNames} me={seat} act={act} />
      )}
    </section>
  );
}

export function QuizorSeatIcon({ seat, size = 28 }: SeatIconProps) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <rect
        x="2"
        y="2"
        width="28"
        height="28"
        rx="10"
        fill={SEAT_COLORS[seat % SEAT_COLORS.length]}
      />
      <path
        d="M10 10h12v10H10zM18 19l6 6"
        fill="none"
        stroke="#181628"
        strokeWidth="3"
        strokeLinejoin="round"
      />
    </svg>
  );
}
