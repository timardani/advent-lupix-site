// Fájlalapú tároló a /data (DATA_DIR) alatt: atomikus írás, JSONL napló, automatikus mentések.
import fs from 'node:fs';
import path from 'node:path';

const MAX_MENTES = 40;

export function createStore(dataDir, configDir) {
  fs.mkdirSync(path.join(dataDir, 'kepek'), { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'mentesek'), { recursive: true });
  const file = f => path.join(dataDir, f);
  const read = (f, def) => {
    try { return JSON.parse(fs.readFileSync(file(f), 'utf8')); } catch (e) {
      if (e.code === 'ENOENT') return def;
      throw e;
    }
  };
  const write = (f, v) => {
    const tmp = `${file(f)}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(v, null, 1));
    fs.renameSync(tmp, file(f));
  };
  const append = (f, obj) => fs.appendFileSync(file(f), JSON.stringify(obj) + '\n');
  const lines = f => {
    try {
      return fs.readFileSync(file(f), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    } catch (e) {
      if (e.code === 'ENOENT') return [];
      throw e;
    }
  };
  // Első induláskor a config/tartalom.json kerül a /data alá; meglévő adatot sosem ír felül.
  if (!fs.existsSync(file('tartalom.json'))) {
    write('tartalom.json', JSON.parse(fs.readFileSync(path.join(configDir, 'tartalom.json'), 'utf8')));
  }

  /** Mentés a módosítás ELŐTTI állapotról, hogy vissza lehessen állni. */
  function mentes(doc, ok) {
    const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-v${doc.verzio}`;
    fs.writeFileSync(path.join(dataDir, 'mentesek', `${id}.json`), JSON.stringify({ ok, doc }));
    const all = fs.readdirSync(path.join(dataDir, 'mentesek')).filter(f => f.endsWith('.json')).sort();
    for (const f of all.slice(0, Math.max(0, all.length - MAX_MENTES))) fs.unlinkSync(path.join(dataDir, 'mentesek', f));
    return id;
  }
  function mentesLista() {
    return fs.readdirSync(path.join(dataDir, 'mentesek')).filter(f => f.endsWith('.json')).sort().reverse().map(f => {
      const id = f.slice(0, -5);
      let ok = '';
      try { ok = JSON.parse(fs.readFileSync(path.join(dataDir, 'mentesek', f), 'utf8')).ok; } catch { /* sérült */ }
      return { id, ok };
    });
  }
  function mentesBetolt(id) {
    if (!/^[\w-]{10,80}$/.test(id)) return null;
    try { return JSON.parse(fs.readFileSync(path.join(dataDir, 'mentesek', `${id}.json`), 'utf8')).doc; } catch { return null; }
  }
  return { read, write, append, lines, file, mentes, mentesLista, mentesBetolt };
}
