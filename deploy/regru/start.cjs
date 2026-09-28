// Под Node 22: сервер собран в ESM с top-level await, из CommonJS его можно только импортировать.
import('./server.mjs').catch((e) => {
  console.error(e)
  process.exit(1)
})
