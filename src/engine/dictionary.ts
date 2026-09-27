// Словарь поведенческих индикаторов в том виде, в каком его ест движок.
// Сам словарь (тексты, веса, маркеры) живёт в behaviors.ts — здесь только форма.

export interface BehaviorRule {
  id: string
  label: string            // «Спросил об интересах»
  hint?: string            // как распознать — для промпта разметчика
  trust: number            // сдвиг доверия за одно проявление
  tension: number          // сдвиг напряжения
  kind: 'good' | 'bad' | 'neutral'
  asksInterest?: boolean   // считается вопросом о причинах/интересах
  markers?: RegExp[]       // русские маркеры для офлайн-разметки
  advice?: string          // что сказать в разборе
}

export type BehaviorDict = Record<string, BehaviorRule>

export function toDict(rules: BehaviorRule[]): BehaviorDict {
  return Object.fromEntries(rules.map((r) => [r.id, r]))
}
