import { Suspense, useDeferredValue, useEffect, useState, type ReactNode } from 'react'

function Loading() {
  return <div className="g-loading" role="status">Загружаем экран…</div>
}

/** При первом открытии ещё нет прежнего экрана, но короткая загрузка тоже не должна мигать. */
export function InitialLoading() {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 300)
    return () => clearTimeout(timer)
  }, [])
  return visible ? <Loading /> : null
}

/** Пока новый ленивый экран грузится, React сохраняет прежнее дерево вместе с его состоянием. */
export function ScreenBoundary({ children }: { children: ReactNode }) {
  const deferred = useDeferredValue(children)
  const [expired, setExpired] = useState<ReactNode>(null)
  useEffect(() => {
    if (children === deferred) return
    const timer = setTimeout(() => setExpired(children), 300)
    return () => clearTimeout(timer)
  }, [children, deferred])
  // После 300 мс разрешаем обычный Suspense fallback. Быстрый импорт заменяет экран без заглушки.
  const timedOut = expired === children
  return <Suspense fallback={timedOut ? <Loading /> : <InitialLoading />}>{timedOut ? children : deferred}</Suspense>
}
