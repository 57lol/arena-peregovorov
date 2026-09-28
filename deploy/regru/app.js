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
  } catch (e) {}
  var log = fs.openSync(LOG, 'a')
  // Passenger ограничивает виртуальную память, а WebAssembly в V8 резервирует её гигабайтами
  // (под ним работает fetch) — без этого флага первый же запрос к YandexGPT роняет процесс.
  var child = require('child_process').spawn(NODE, ['--disable-wasm-trap-handler'].concat(process.argv.slice(1)), {
    stdio: ['inherit', log, log],
    env: process.env,
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
