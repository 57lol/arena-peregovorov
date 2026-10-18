// Точка входа Passenger на хостинге рег.ру (кладётся в ~/www/app.js).
// Passenger там запускает системный node 10, а сменить бинарник из .htaccess нельзя
// (PassengerNodejs "not allowed here"). Поэтому под node 10 этот файл только
// перезапускает загрузчик Passenger под нашим Node 22 из ~/node: тот читает те же
// аргументы из PASSENGER_SPAWN_WORK_DIR, снова грузит этот файл, и уже под Node 22
// поднимается сервер игры. Сокет Passenger получает от дочернего процесса.
// Синтаксис — только то, что понимает node 10.
var fs = require('fs')
var home = process.env.HOME
var APP = home + '/arena-app'
var NODE = home + '/node/bin/node'
// логи Passenger на хостинге не видны, поэтому вывод сервера пишем сами
var LOG = home + '/arena-data/server.log'

if (Number(process.versions.node.split('.')[0]) >= 22) {
  process.chdir(APP)
  require(APP + '/start.cjs')
} else {
  try {
    if (fs.statSync(LOG).size > 5e6) fs.renameSync(LOG, LOG + '.1')
    // eslint-disable-next-line no-unused-vars -- под node 10 catch без параметра не пишем
  } catch (e) {}
  var log = fs.openSync(LOG, 'a')
  // Passenger ограничивает виртуальную память, а WebAssembly в V8 резервирует её гигабайтами
  // (под ним работает fetch) — без этого флага первый же запрос к YandexGPT роняет процесс.
  // Хостинг ограничивает число потоков на аккаунт: при упоре pthread_create падает (Resource temporarily unavailable),
  // и сайт ~1,5 мин отвечает 500. Node 22 по умолчанию держит ~11 потоков: пул V8 по числу ядер и 4 потока libuv.
  // Нам хватает по два: тяжёлой работы в процессе нет, worker_threads не используем.
  var child = require('child_process').spawn(NODE, ['--disable-wasm-trap-handler', '--v8-pool-size=2'].concat(process.argv.slice(1)), {
    stdio: ['inherit', log, log],
    env: Object.assign({}, process.env, { UV_THREADPOOL_SIZE: '2' }),
  })
  child.on('exit', function (code) {
    process.exit(code == null ? 1 : code)
  })
  process.on('exit', function () {
    child.kill()
  })
  ;['SIGTERM', 'SIGINT', 'SIGHUP'].forEach(function (sig) {
    process.on(sig, function () {
      child.kill(sig)
    })
  })
}
