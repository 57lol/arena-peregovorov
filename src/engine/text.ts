/** Заголовок внутри фразы: понижаем первую букву, сохраняя аббревиатуры (MOQ, НДС, B2B). */
export function lowerFirst(text: string): string {
  if (/^\p{Lu}(?:[\p{Lu}\p{N}]|\.\p{Lu})/u.test(text)) return text
  return text.replace(/^\p{Lu}/u, (letter) => letter.toLowerCase())
}
