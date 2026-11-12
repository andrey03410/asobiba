import type { BoardProps } from "@asobiba/sdk";
import type { QuizorView } from "../game";
import { resolveVisual } from "../visual";
import type { Block } from "../rules";

function flattenBlocks(blocks: Block[]): Block[] {
  return blocks.flatMap((block) =>
    block.type === "group" ? flattenBlocks(block.blocks ?? []) : [block],
  );
}

function lines(text: string, max: number, count: number): string[] {
  const out: string[] = [];
  let row = "";
  for (const word of text.split(/\s+/)) {
    if (`${row} ${word}`.trim().length > max && row) {
      out.push(row);
      row = word;
    } else row = `${row} ${word}`.trim();
  }
  if (row) out.push(row);
  return out
    .slice(0, count)
    .map((s, i) =>
      i === count - 1 && out.length > count ? `${s.slice(0, max - 1)}…` : s,
    );
}
export function StaticBoard({ match, config, assetUrl }: BoardProps) {
  const v = match.game as QuizorView;
  const visual = resolveVisual(v.roundVisual ?? (config.visual as never));
  const cells = v.board ?? [];
  const blocks = flattenBlocks(v.blocks ?? []);
  const image = blocks.find((b) => b.type === "image" && b.asset);
  const roundTitle = v.title || config.title;
  const board = v.phase === "board" && cells.length > 0;
  const themes = [...new Set(cells.map((c) => c.theme))].slice(0, 8);
  const columnWidth = 1090 / Math.max(1, themes.length);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1200 720"
      width="1200"
      height="720"
      fontFamily="Arial, sans-serif"
    >
      <defs>
        <linearGradient id="qz-bg" x2="1" y2="1">
          <stop stopColor={visual.surface} />
          <stop offset="1" stopColor={visual.background} />
        </linearGradient>
      </defs>
      <rect width="1200" height="720" rx="24" fill="url(#qz-bg)" />
      <circle cx="1080" cy="100" r="180" fill="#8e72ff" opacity=".07" />
      <text x="55" y="66" fill={visual.accent} fontSize="25" letterSpacing="5">
        QUIZOR
      </text>
      <text x="55" y="107" fill={visual.foreground} fontSize="29">
        {roundTitle.slice(0, 65)}
      </text>
      {board ? (
        themes.map((theme, col) => (
          <g key={theme} transform={`translate(${55 + col * columnWidth} 140)`}>
            <text
              x={(columnWidth - 12) / 2}
              y="23"
              textAnchor="middle"
              fontSize="19"
              fill={visual.muted}
            >
              {theme.slice(0, 19)}
            </text>
            {cells
              .filter((c) => c.theme === theme)
              .slice(0, 6)
              .map((cell, row) => (
                <g
                  key={cell.questionId}
                  transform={`translate(0 ${40 + row * 65})`}
                >
                  <rect
                    width={columnWidth - 12}
                    height="54"
                    rx="10"
                    fill={visual.surface}
                    opacity={cell.played ? 0.35 : 1}
                  />
                  <text
                    x={(columnWidth - 12) / 2}
                    y="34"
                    textAnchor="middle"
                    fontSize="23"
                    fill={cell.played ? visual.muted : visual.accent}
                  >
                    {cell.played ? "—" : cell.value}
                  </text>
                </g>
              ))}
          </g>
        ))
      ) : (
        <>
          {image?.asset && assetUrl(image.asset) && (
            <image
              href={assetUrl(image.asset)}
              x="400"
              y="140"
              width="400"
              height="200"
              preserveAspectRatio="xMidYMid meet"
            />
          )}
          {lines(
            v.prompt ||
              (v.phase === "intro"
                ? "Готовы проверить себя?"
                : v.reference || config.title),
            53,
            5,
          ).map((line, i) => (
            <text
              key={i}
              x="600"
              y={(image ? 390 : 245) + i * 48}
              fill={visual.foreground}
              fontSize="36"
              textAnchor="middle"
            >
              {line}
            </text>
          ))}
          <rect
            x="350"
            y="505"
            width="500"
            height="54"
            rx="14"
            fill="#3c3860"
          />
          <text
            x="600"
            y="540"
            textAnchor="middle"
            fill="#bcb7d6"
            fontSize="23"
          >
            {v.phase === "reveal" ? "Разбор ответа" : "Ваш ответ"}
          </text>
        </>
      )}
      <path d="M40 606H1160" stroke="#434661" />
      {(v.players ?? []).slice(0, 8).map((p, i, a) => {
        const x = 70 + i * (1080 / Math.max(a.length, 1));
        return (
          <g key={p.seat} transform={`translate(${x} 640)`}>
            <circle
              cx="15"
              cy="15"
              r="18"
              fill={["#ae94ff", "#65d6cc", "#ffbb70", "#f48dac"][i % 4]}
            />
            <text
              x="15"
              y="22"
              textAnchor="middle"
              fontSize="20"
              fill="#171626"
            >
              {p.seat + 1}
            </text>
            <text x="43" y="22" fontSize="24" fill="#fff">
              {p.score ?? "—"}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
