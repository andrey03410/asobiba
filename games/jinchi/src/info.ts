import type { ConfigDocument, ConfigSummary, GameInformation, TuningDirection } from "@asobiba/sdk";
import type { JinchiRules } from "./rules";

export const JINCHI_INFO: GameInformation = {
  overview: "Пошаговая борьба за территорию: два кубика задают прямоугольник, а замкнутое кольцо забирает окружённые клетки.",
  audience: "Для компании, которой нравится выбирать маршруты, окружать соперников и рисковать ради целей.", players: { min: 2, max: 8 },
  goal: "Растите от своей базы, окружайте территории и побеждайте по выбранному критерию — очкам или флагам.",
  turn: "Бросьте два кубика и поставьте полученный прямоугольник рядом со своей территорией. Можно повернуть его, если нет помехи. После постановки срабатывает окружение.",
  example: "Бросок 3 и 5 даёт фигуру 3×5 или 5×3. Можно расширить фронт или замкнуть кольцо, чтобы забрать область целиком.",
  highlights: ["Стены и края могут помогать окружению — это зависит от правил партии.", "Флаги и спецклетки делают выбор маршрута важнее; неизвестные клетки заранее показывают пул последствий и шансы."],
};

export const JINCHI_TUNING: TuningDirection[] = [
  { id: "geometry", title: "Геометрия и состав", description: "Прямоугольник или круг, 2–8 игроков, карта до 1000×1000.", paths: ["rules.map"], options: [{ label: "Круг под состав", consequence: "Секторные старты дают несколько фронтов; радиус 50 означает поле 101×101." }, { label: "Ручная карта", consequence: "Можно сделать намеренно неравный сценарий; равные шансы не заявляются автоматически." }] },
  { id: "obstacles", title: "Препятствия", description: "Стены создают обходы и узкие места.", paths: ["rules.map.rows"], options: [{ label: "Смешанные структуры", consequence: "Гряды, озёра и укрепления предлагают разные маршруты." }, { label: "Больше открытого пространства", consequence: "Крупным прямоугольникам легче найти место." }] },
  { id: "dice", title: "Кубики", description: "Два независимых кубика от d2 до d100; обычно d6+d6.", paths: ["rules.dice"], options: [{ label: "Два d6", consequence: "Больше контроля на тесной карте." }, { label: "Крупнее или разные", consequence: "Территория растёт быстрее, но бросок чаще не помещается; поворот не меняет значения кубиков." }] },
  { id: "capture", title: "Постановка и окружение", description: "Соседство, стены, диагонали и чужие территории.", paths: ["rules.placement", "rules.capture"], options: [{ label: "Стены помогают кольцу", consequence: "Можно пользоваться берегами и укреплениями для захвата." }, { label: "Сохранить чужие базы", consequence: "Окружение забирает территорию, но не исходные стартовые клетки." }] },
  { id: "flags", title: "Флаги", description: "Без флагов, главный критерий или очковый бонус.", paths: ["rules.flags"], options: [{ label: "Гонка за флагами", consequence: "Сначала сравниваем захваты; возможна немедленная цель X." }, { label: "Бонус к территории", consequence: "Каждый одноразовый флаг приносит одинаковое заданное число очков." }] },
  { id: "effects", title: "Спецклетки", description: "Известные эффекты и неизвестные клетки с настраиваемыми весами.", paths: ["rules.effects"], options: [{ label: "Обычные сюрпризы", consequence: "Тайник, ловушка, запасной бросок или запрет поворота добавляют риск маршрута." }, { label: "Без спецклеток", consequence: "Победа зависит от территории и выбранных флагов; случайность остаётся в кубиках." }] },
  { id: "tempo", title: "Темп и оформление", description: "Предел кругов, ранняя цель, часы, серия и вступление для друзей.", paths: ["rules.end", "timer", "series", "visual", "info"], options: [{ label: "Лимит кругов или цель флагов", consequence: "Большое поле не нужно заполнять целиком." }, { label: "Таймер с пропуском", consequence: "Молчащий участник не задерживает партию; заряд переброса автоматически не расходуется." }, { label: "Долгая игра без лимита", consequence: "Нужно явно выбрать её после обсуждения размеров кубиков на карте крупнее 200." }] },
];

type Effect = { kind: "cache" | "trap" | "reroll" | "lock" | "mystery"; value?: number };
function effectText(effect: Effect): string {
  switch (effect.kind) {
    case "cache": return `Тайник +${effect.value ?? 25} очков`;
    case "trap": return `Ловушка −${effect.value ?? 15} очков`;
    case "reroll": return "Запасной бросок: +1 заряд";
    case "lock": return "Скованность: следующий собственный ход без поворота";
    case "mystery": return "Неизвестная клетка";
  }
}

export function summarizeJinchiConfig(config: ConfigDocument<JinchiRules>): ConfigSummary {
  const r = config.rules;
  const sides = typeof r.dice.sides === "number" ? [r.dice.sides, r.dice.sides] : r.dice.sides;
  const bases = new Set<string>();
  let walls = 0;
  for (const row of r.map.rows) for (const cell of row) { if (cell >= "1" && cell <= "8") bases.add(cell); else if (cell === "#") walls++; }
  const flags = r.flags;
  const effects = r.effects?.cells ?? [];
  const flagsMode = flags?.mode ?? "off";
  const victory = flagsMode === "primary" ? "Сначала сравниваем захваченные флаги, при равенстве — очки территории и эффектов." : flagsMode === "bonus" ? `Больше очков: клетки + флаги × ${flags?.value ?? 25} + баланс эффектов.` : effects.length ? "Больше очков: текущие клетки плюс постоянный баланс эффектов." : "Больше текущих клеток территории.";
  const flagText = flagsMode === "off" ? "Флаги выключены." : flagsMode === "primary" ? `Флаги — главное; всего ${flags?.positions.length ?? 0}${flags?.target ? `, немедленная цель ${flags.target}` : ", без немедленной цели"}. Сбор всех заканчивает раунд.` : `Флаги как бонус: ${flags?.positions.length ?? 0} по ${flags?.value ?? 25} очков. Сбор всех сам по себе не заканчивает раунд.`;
  const end = ["Остался один игрок с территорией — он побеждает, даже если флагов меньше.", "Если никто не может поставить даже 1×1, сравниваем итоговый счёт.", ...(r.end.skipRounds ? [`Конец после ${r.end.skipRounds} кругов подряд без постановок.`] : []), ...(r.end.maxRounds ? [`Предел: ${r.end.maxRounds} кругов.`] : []), ...(r.end.targetPercent ? [`Немедленная победа за ${r.end.targetPercent} % игровой площади; бонусные очки в долю не входят.`] : []), "Круг — каждый оставшийся игрок сходил или пропустил. Выбывшие не претендуют на победу; равенство всех критериев — ничья."];
  const pool = r.effects?.mysteryPool ?? [];
  const totalWeight = pool.reduce((sum, e) => sum + e.weight, 0);
  const known = new Map<string, number>();
  for (const cell of effects) { const label = effectText(cell); known.set(label, (known.get(label) ?? 0) + 1); }
  const area = r.map.width * r.map.height - walls;
  const severe = [...effects, ...pool].some((e) => (e.kind === "cache" || e.kind === "trap") && (e.value ?? (e.kind === "cache" ? 25 : 15)) > area * 0.1);
  return {
    players: { min: r.map.expectedPlayers ?? 2, max: bases.size }, objective: flagsMode === "primary" ? "Собирайте одноразовые флаги, сохраняя территорию." : "Растите прямоугольниками и окружайте области ради очков.",
    turn: `Два кубика d${sides[0]} + d${sides[1]} дают прямоугольник a×b или b×a. Бросок ${r.dice.roll === "auto" ? "автоматический" : "по кнопке"}; поставьте фигуру ${r.placement.adjacency === "side" ? "стороной" : "стороной или углом"} к своей территории.`, victory: `${victory} Устранение всех остальных — альтернативная победа.`,
    highlights: [`Карта ${r.map.width}×${r.map.height}; стартовых зон ${bases.size}; игровая площадь ${area}.`, `Кубики d${sides[0]} + d${sides[1]}, ${r.dice.roll === "auto" ? "автобросок" : "ручной бросок"}.`, r.capture.walls ? "Стены и края помогают окружению; меньшие области захватываются, все самые большие остаются открытыми." : "Окружение только своими клетками; стены и края не замыкают кольцо.", flagText, effects.length ? `Спецклеток: ${effects.length}.${severe ? " Один эффект может изменить больше 10 % очков игровой площади." : ""}` : "Спецклетки выключены.", r.end.maxRounds ? `Не более ${r.end.maxRounds} кругов.` : "Без предела кругов; действуют остальные условия окончания."],
    sections: [
      { id: "starts", title: "Старт и состав", items: [`Стартовые позиции ${r.starts.assignment === "random" ? "раздаются случайно" : "раздаются по номерам"}.`, r.map.expectedPlayers ? `Требуется полный состав: ${r.map.expectedPlayers} игроков.` : `При неполном составе лишние базы становятся ${r.starts.unused === "empty" ? "свободными клетками" : "стенами"}; баланс под фактический состав не гарантируется.`] },
      { id: "placement", title: "Постановка и окружение", items: ["Прямоугольник целиком на карте, не накрывает стены и чужие клетки.", r.placement.overlapOwn ? "Свои клетки можно накрывать, если есть хотя бы одна новая." : "Накрывать свои клетки нельзя.", `Касание углом ${r.capture.diagonal ? "замыкает" : "не замыкает"} кольцо.`, r.capture.opponents === "all" ? "Чужие клетки внутри кольца становятся вашими; игрок без клеток выбывает." : r.capture.opponents === "except-starts" ? "Чужие клетки захватываются, исходные базы защищены." : "Чужие клетки внутри кольца сохраняют владельца.", "Невозможный бросок пропускается; с зарядом доступен выбор перебросить оба кубика. Добровольного пропуска пригодного броска нет."] },
      { id: "flags", title: "Флаги", items: [flagText, ...(flagsMode !== "off" ? ["Первое присоединение клетки постановкой или окружением забирает флаг навсегда. Повторный перехват его не начисляет."] : [])] },
      { id: "effects", title: "Легенда спецклеток", items: effects.length ? [...known].map(([label, count]) => `${label}: ${count}.`).concat(["Бонус и штраф меняют очки, не площадь. Все объекты активируются один раз, в том числе при окружении.", "Заряды копятся до 3; максимум один переброс обоих кубиков за ход, таймер не сбрасывается. Скованность действует один следующий собственный ход и не складывается."]) : ["Спецклеток нет."] },
      ...(effects.some((e) => e.kind === "mystery") ? [{ id: "random", title: "Пул неизвестной клетки", items: pool.filter((e) => e.weight > 0).map((e) => `${effectText(e)}: ${Number((100 * e.weight / totalWeight).toFixed(2))} %.`).concat(["Это шансы отдельной активации, не гарантированный состав карты. Конкретный исход раскрывается при захвате."]) }] : []),
      { id: "end", title: "Победа и окончание", items: [victory, ...end] },
    ],
  };
}
