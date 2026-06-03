import * as SQLite from 'expo-sqlite';

// 一条采集记录的形状（存进本地库的字段）
export type NewRecord = {
  created_at: number; // 结束采集的时间（Unix 毫秒）
  duration_sec: number; // 采集时长（秒）
  distance_m: number | null; // 轨迹总距离（米），本地算，不依赖后端
  avg_hr: number | null; // 平均心率
  green_view: number | null; // 绿视率（如果这次测了）
};

// 打开数据库（只打开一次，之后复用）
let dbPromise: ReturnType<typeof SQLite.openDatabaseAsync> | null = null;
function getDb() {
  if (!dbPromise) dbPromise = SQLite.openDatabaseAsync('park20.db');
  return dbPromise;
}

// 建表（不存在才建）。每次 App 启动调一下，幂等、安全
export async function initDb() {
  const db = await getDb();
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at INTEGER NOT NULL,
      duration_sec INTEGER NOT NULL,
      distance_m REAL,
      avg_hr INTEGER,
      green_view REAL
    );
  `);
}

// 插入一条记录
export async function addRecord(r: NewRecord) {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO records (created_at, duration_sec, distance_m, avg_hr, green_view) VALUES (?, ?, ?, ?, ?)',
    [r.created_at, r.duration_sec, r.distance_m, r.avg_hr, r.green_view]
  );
}

// 读出所有记录，最新的在前
export async function getRecords() {
  const db = await getDb();
  return db.getAllAsync('SELECT * FROM records ORDER BY created_at DESC');
}

// 清空（方便测试）
export async function clearRecords() {
  const db = await getDb();
  await db.execAsync('DELETE FROM records');
}
