import type { ConfigPreset } from "@asobiba/sdk";

type Position = readonly [number, number];
function map(width: number, height: number, starts: readonly Position[], walls: (x: number, y: number) => boolean = () => false) {
  const rows: string[][] = Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => walls(x, y) ? "#" : "."));
  starts.forEach(([x, y], seat) => {
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) rows[y + dy]![x + dx] = String(seat + 1);
  });
  return { width, height, rows: rows.map((row) => row.join("")) };
}
const corners = (w: number, h: number): Position[] => [[0, 0], [w - 2, h - 2], [w - 2, 0], [0, h - 2]];

export const PRESETS: ConfigPreset[] = [
  { id: "duel", title: "Дуэль", description: "16×16, две базы по углам, классические d6", config: { title: "Jinchi: Дуэль", rules: { map: map(16, 16, corners(16, 16).slice(0, 2)) } } },
  { id: "four-corners", title: "Четыре угла", description: "24×24 на четверых, открытая карта", config: { title: "Jinchi: Четыре угла", rules: { map: map(24, 24, corners(24, 24)) } } },
  { id: "fortresses", title: "Крепости", description: "32×24, стены-укрытия вокруг четырёх баз", config: { title: "Jinchi: Крепости", rules: { map: map(32, 24, [[2, 2], [28, 20], [28, 2], [2, 20]], (x, y) => ((x === 6 || x === 25) && (y < 7 || y > 16) && y !== 3 && y !== 20) || ((y === 6 || y === 17) && (x < 7 || x > 24) && x !== 3 && x !== 28)) } } },
  { id: "labyrinth", title: "Лабиринт", description: "36×28, кубики d4, кольцо только из своих клеток", config: { title: "Jinchi: Лабиринт", rules: { map: map(36, 28, corners(36, 28), (x, y) => x > 3 && x < 32 && x % 7 === 0 && (Math.floor(x / 7) % 2 === 0 ? y > 5 : y < 22)), dice: { sides: 4 }, capture: { walls: false }, placement: { overlapOwn: true } } } },
  { id: "mainland", title: "Материк", description: "120×80 на шестерых: огромная карта с озёрами", config: { title: "Jinchi: Материк", rules: { map: map(120, 80, [[1, 1], [117, 77], [117, 1], [1, 77], [59, 1], [59, 77]], (x, y) => ((x - 35) ** 2 / 100 + (y - 40) ** 2 / 49 < 1) || ((x - 85) ** 2 / 100 + (y - 40) ** 2 / 49 < 1)), end: { maxRounds: 100 } } } },
  { id: "octahedrons", title: "Восьмигранники", description: "80×60 на восьмерых, d8 и защищённые базы", config: { title: "Jinchi: Восьмигранники", rules: { map: map(80, 60, [[1, 1], [77, 57], [77, 1], [1, 57], [39, 1], [39, 57], [1, 29], [77, 29]]), dice: { sides: 8 }, capture: { opponents: "except-starts" }, placement: { adjacency: "corner" }, end: { maxRounds: 100 } } } },
];
