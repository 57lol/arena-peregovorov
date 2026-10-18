import { defineConfig, mergeConfig } from 'vitest/config'
import vite from './vite.config.ts'

// Потоки дешевле отдельных Node-процессов при --maxWorkers=2.
// Изоляцию файлов оставляем включённой: у серверных тестов свои env, кэши и моки.
export default mergeConfig(vite, defineConfig({ test: { pool: 'threads', isolate: true } }))
