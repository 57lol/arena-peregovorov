// Точка входа Passenger на хостинге рег.ру (кладётся в ~/www/app.js).
// Passenger там запускает системный node 10, а сменить бинарник из .htaccess нельзя
// (PassengerNodejs "not allowed here"). Поэтому под node 10 этот файл только
// перезапускает загрузчик Passenger под нашим Node 22 из ~/node: тот читает те же
// аргументы из PASSENGER_SPAWN_WORK_DIR, снова грузит этот файл, и уже под Node 22
// поднимается сервер игры. Сокет Passenger получает от дочернего процесса.
// Синтаксис — только то, что понимает node 10.
var home = process.env.HOME
var APP = home + '/arena-app'
var NODE = home + '/node/bin/node'

if (Number(process.versions.node.split('.')[0]) >= 22) {
  process.chdir(APP)
  require(APP + '/start.cjs')
} else {
  var child = require('child_process').spawn(NODE, process.argv.slice(1), {
    stdio: 'inherit',
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
