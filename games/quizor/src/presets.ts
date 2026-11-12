import type { ConfigPreset } from "@asobiba/sdk";
const q = (id: string, prompt: string, answer: string) => ({
  id,
  prompt,
  fields: [{ id: "answer", type: "text", answers: [{ text: answer }] }],
});
const classic = [
  q("earth", "Какая планета третья от Солнца?", "Земля"),
  q("water", "Как называется вода в твёрдом состоянии?", "Лёд"),
  q("rainbow", "Сколько цветов принято выделять в радуге?", "Семь"),
];
const board = (round: number) => ({
  id: `board-${round}`,
  title: `Табло ${round}`,
  format: "board",
  themes: ["Мир", "Наука", "Искусство", "История", "Слова"],
  values: [100, 200, 300, 400, 500].map((v) => v * round),
  questions: Array.from({ length: 25 }, (_, i) => ({
    ...q(
      `b${round}-${i}`,
      `${["Сколько дней в неделе?", "Какой газ нужен человеку для дыхания?", "Кто написал «Евгения Онегина»?", "В каком месяце начинается год?", "Антоним слова «ночь»?"][Math.floor(i / 5)]} (${(i % 5) + 1})`,
      ["Семь", "Кислород", "Пушкин", "Январь", "День"][Math.floor(i / 5)],
    ),
    theme: ["Мир", "Наука", "Искусство", "История", "Слова"][Math.floor(i / 5)],
    value: ((i % 5) + 1) * 100 * round,
    ...(i === 2
      ? { special: { type: "transfer" } }
      : i === 7
        ? { special: { type: "auction" } }
        : i === 12
          ? { special: { type: "wager-all" } }
          : i === 17
            ? { special: { type: "risk-free" } }
            : i === 22
              ? { special: { type: "gift" } }
              : {}),
  })),
});
export const PRESETS: ConfigPreset[] = [
  {
    id: "classic",
    title: "Классический",
    description: "Все отвечают тайно, алгоритм, три демонстрационных вопроса",
    config: {
      title: "Quizor: классика",
      rules: {
        rounds: [{ id: "classic", title: "Разминка", questions: classic }],
      },
      series: { rounds: 1 },
      timer: { turnSeconds: 0 },
    },
  },
  {
    id: "board",
    title: "Табло",
    description: "Два табло 5×5, особые вопросы, отсев тем и финальные ставки",
    config: {
      title: "Quizor: табло",
      rules: {
        presenter: "optional",
        rounds: [board(1), board(2)],
        final: {
          type: "elimination-wager",
          eligibility: "all",
          questions: [
            {
              ...q("f1", "Сколько сторон у треугольника?", "Три"),
              theme: "Геометрия",
            },
            { ...q("f2", "Какой спутник у Земли?", "Луна"), theme: "Космос" },
            {
              ...q("f3", "Как называется столица Франции?", "Париж"),
              theme: "Города",
            },
          ],
        },
      },
      series: { rounds: 1 },
      timer: { turnSeconds: 0 },
    },
  },
  {
    id: "presenter",
    title: "С ведущим",
    description: "Устные ответы на кнопке; без ведущего — голосование",
    config: {
      title: "Quizor с ведущим",
      rules: {
        presenter: "optional",
        defaults: { mode: "buzz", judge: "assisted" },
        rounds: [
          {
            id: "oral",
            questions: [
              {
                id: "oral1",
                prompt: "Назовите столицу Японии",
                fields: [{ id: "answer", type: "oral", reference: "Токио" }],
              },
            ],
          },
        ],
      },
      series: { rounds: 1 },
      timer: { turnSeconds: 0 },
    },
  },
  {
    id: "blitz",
    title: "Блиц",
    description: "Общий таймер, раскрытие в конце раунда",
    config: {
      title: "Quizor: блиц",
      rules: {
        defaults: {
          reveal: "round",
          timers: { roundSeconds: 120, answerSeconds: 15 },
        },
        rounds: [{ id: "blitz", title: "Блиц", questions: classic }],
      },
      series: { rounds: 1 },
      timer: { turnSeconds: 0 },
    },
  },
  {
    id: "estimate",
    title: "Оценка",
    description: "Числа, ближайший ответ и штраф за большой промах",
    config: {
      title: "Quizor: оценка",
      rules: {
        rounds: [
          {
            id: "numbers",
            questions: [
              {
                id: "steps",
                prompt: "Сколько метров в километре?",
                fields: [
                  {
                    id: "answer",
                    type: "number",
                    target: 1000,
                    steps: [
                      {
                        condition: { type: "range", min: 990, max: 1010 },
                        grade: "correct",
                      },
                      {
                        condition: { type: "nearest", rank: 1 },
                        grade: "correct",
                      },
                      {
                        condition: {
                          type: "distance",
                          op: "gt",
                          value: 100,
                          unit: "percent",
                        },
                        grade: "fail",
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      series: { rounds: 1 },
      timer: { turnSeconds: 0 },
    },
  },
  {
    id: "solo",
    title: "Соло",
    description: "Свой темп и самопроверка устных ответов",
    config: {
      title: "Quizor: соло",
      rules: {
        players: { min: 1, max: 1 },
        defaults: { pacing: "self", judge: "self" },
        rounds: [
          {
            id: "solo",
            questions: [
              {
                id: "solo1",
                prompt: "Назовите три агрегатных состояния вещества",
                fields: [
                  {
                    id: "answer",
                    type: "oral",
                    reference: "Твёрдое, жидкое, газообразное",
                  },
                ],
              },
            ],
          },
        ],
      },
      series: { rounds: 1 },
      timer: { turnSeconds: 0 },
    },
  },
];
