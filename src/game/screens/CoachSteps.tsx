const STEPS = ['Дело', 'Проверьте встречу', 'Ссылка команде']

export function CoachSteps({ current }: { current: 1 | 2 | 3 }) {
  return (
    <ol className="g-coach-steps" aria-label="Подготовка тренировки">
      {STEPS.map((label, index) => (
        <li key={label} aria-current={current === index + 1 ? 'step' : undefined} className={index + 1 < current ? 'is-done' : undefined}>
          <span className="g-coach-step-number" aria-hidden="true">{index + 1}</span>
          <span>{label}</span>
        </li>
      ))}
    </ol>
  )
}
