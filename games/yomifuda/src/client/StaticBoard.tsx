import type { BoardProps } from '@asobiba/sdk';
import type { YomifudaView } from '../index';
import { visualSchema } from '../rules';
import { palette } from './arena-plan';
/** SVG preview is deliberately labelled as educational; previewMatch never consumes the user's deck. */
export function StaticBoard({ match, config }: BoardProps) {
  const view = match.game as YomifudaView;
  const visual = visualSchema.parse(config.visual ?? {}), c = palette(visual.theme);
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 520" role="img" aria-label="Учебная Ёмифуда — пример стола" style={{ width: '100%', height: '100%', maxHeight: 520 }}>
    <rect width="720" height="520" rx="26" fill={c.bg} />
    {[160, 240, 320].map(r => <circle key={r} cx="360" cy="250" r={r} fill="none" stroke={c.line} />)}
    <g fontFamily="sans-serif" textAnchor="middle">
      <text x="360" y="44" fontSize="15" letterSpacing="3" fill={visual.accent}>遊び場 · ЁМИФУДА</text>
      <text x="360" y="82" fontSize="28" fill={c.ink}>{view.attribute.label}</text>
      {view.players.slice(0, 3).map((p, i) => {
        const t = view.table.find(t => t.seat === p.seat); const open = t && !t.hidden ? t : null;
        const x = 33 + i * 228;
        return <g key={p.seat}>
          <rect x={x} y="115" width="198" height="292" rx="18" fill={c.card} stroke={open?.winner ? '#f6cc79' : c.line} strokeWidth="2" />
          <rect x={x + 10} y="125" width="178" height="158" rx="12" fill={c.line} />
          <circle cx={x + 99} cy="204" r="50" fill="none" stroke={visual.accent} />
          <text x={x + 99} y="222" fontSize="52" fill={visual.accent}>{open ? open.card.name.slice(0, 1) : '遊'}</text>
          <text x={x + 99} y="312" fontSize="16" fill={c.ink}>{open ? open.card.name : 'Карта закрыта'}</text>
          <text x={x + 99} y="339" fontSize="12" fill={c.muted}>{open ? open.card.anime.slice(0, 26) : 'Выбор ещё впереди'}</text>
          <text x={x + 99} y="383" fontSize="32" fill={visual.accent}>{open ? open.value : '·'}</text>
          <text x={x + 99} y="440" fontSize="17" fill={c.ink}>Игрок {p.seat + 1} · {p.score}</text>
        </g>;
      })}
      <text x="360" y="488" fontSize="15" fill={c.muted}>Учебная колода · ваши карты и оценки скрыты</text>
    </g>
  </svg>;
}
