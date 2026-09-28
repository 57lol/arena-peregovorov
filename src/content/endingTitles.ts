// Общие названия финалов. Отдельным файлом, чтобы дела кампании брали их без круга импортов с endings.ts.

import type { EndingId } from '../engine/endings'

export const TITLE: Record<EndingId, string> = {
  legend: 'Сделка, о которой расскажут',
  cold_win: 'Выиграли цену, проиграли человека',
  middling: 'Нормально. Но…',
  lose_lose: 'Оба в минусе',
  short: 'Сами себе дороже',
  walked: 'Ушли вовремя',
  slammed: 'Хлопнул дверью',
  timeout: 'Время вышло',
}
