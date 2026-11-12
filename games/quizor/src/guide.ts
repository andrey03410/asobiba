export const QUIZOR_GUIDE = `# Quizor v1
Квиз — rounds: [{id,title,format:"sequence"|"board",questions:[...]}], final и tiebreak.
Один вопрос: {id:"q",prompt:"Столица России?",fields:[{id:"answer",type:"text",answers:[{text:"Москва"}]}]}.
Правила наследуются game → defaults квиза → settings раунда → settings вопроса → settings поля.
Вложенные объекты сливаются по ключам, массивы заменяются. config_resolve показывает источники,
config_probe принимает массив Answers и объясняет оценки, включая ближайшие ответы всех игроков.
Режимы: secret (все тайно), buzz (честная кнопка), chooser (выбравший), turns (по очереди).
Адресат: all,chooser,turn,owner,random,leader,trailing,presenter. По умолчанию all и secret.
Судьи: algorithm,presenter,assisted,vote,best,self. ai зарезервирован: проверка сейчас запрещает его.
Устному oral нужен человек (presenter/vote/self/assisted); эталон в reference.
Текст: answers/wrong — {text,grade,keywords,strictness,comment}; wrong всегда раньше answers.
strictness literal/exact/strict/normal/soft, text.wordOrder/text.numbers управляют нормализацией.
Оценки grades: {id,label,fraction,points,correct}; fraction умножается на value, points фиксированы.
Число: target число или {min,max}, steps:[{condition,grade}]. Условия exact/range/distance/nearest,
and/or с conditions; distance op lte/lt/gte/gt,unit absolute/percent; nearest rank,side any/under/over.
Выбор choice options:[{id,text,asset?,media?,grade}]; multi options correct, scoring all/per-item/threshold.
order items и correct (id в верном порядке), scoring all/position/pairs. match left/right и correct:{leftId:rightId},
scoring all/per-item/threshold. list items:[{answers:[{text}]}], maxItems, повторы не засчитываются.
point asset,target:{x,y} в 0…1, zones circle/rect с grade и числовые steps по расстоянию/nearest.
Составные поля: combine sum/all/count и countGrades:{"0":"miss","1":"partial","2":"correct"}.
Блоки: text(text,align,size,effect), image(asset,caption,effect), audio/video(asset,from,to,speed,repeat,
volume,replays), pause(durationSeconds), group(blocks,layout). Видео: muted,audioOnly,freeze.
Картинки: blur,pixelate,tiles,zoom,spotlight; текст: words,hidden-words. durationSeconds задаёт длительность.
blocks показываются по порядку, prompt в конце. reveal содержит блоки ответа, intro — заставка раунда.
Музыка: два text поля с половинной стоимостью и audio block. Подсказки: answerOpen:first и blockValues:[50,40,30].
Табло: format:board,themes:[...],values:[100,200,...], questions с theme/value; скрытые special раскрываются при выборе.
Особые: transfer (allowSelf,values), auction (auction open/sealed), wager-all,wager,risk-free,gift; minimum.
Финал: type none/elimination-wager/wager/survival/duel, eligibility all/positive/top/threshold, questions,
keepThemes,banOrder score/turn/secret,wins,bonus,directWinner,minimumWager.
Бонусы: bonuses speed none/linear/rank, speedFraction,rankPoints,streakEvery,streakMultiplier,streakBonus,uniqueBonus.
Таймеры timers answerSeconds (0 без лимита),buzzSeconds,roundSeconds,selectionSeconds,wagerSeconds,revealSeconds.
Пауза доверенным control замораживает всё; после resume отсчёт 3 секунды. Апелляции без ведущего до итогов.
До 500 вопросов и 2 МиБ JSON; медиа из своего пула до 1 ГиБ на квиз. Будущие вопросы и критерии скрыты.
Сначала config_validate, config_resolve, config_probe на верных/неверных/пограничных примерах,
config_preview для вопроса/табло/заставки и config_simulate. Агент не играет за людей.
`;
