import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

/**
 * Une base D1 de test : SQLite en mémoire (le moteur de D1) derrière l'interface D1 (prepare, bind, run, first, all), avec les
 * vraies migrations du dossier migrations/. `calls` compte les requêtes envoyées, pour vérifier qu'on n'interroge pas D1 pour rien.
 * (Demande Node 22.13 ou plus : node:sqlite.)
 */
export function testD1() {
  const db = new DatabaseSync(':memory:')
  const dir = new URL('../migrations/', import.meta.url)
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(f, dir), 'utf8'))
  const d1 = {
    calls: 0,
    failing: false,
    prepare(sql) {
      const stmt = db.prepare(sql)
      return {
        bind: (...args) => ({
          exec: () => { // pour batch() : une lecture rend ses lignes, comme D1
            if (/^\s*(SELECT|WITH)\b/i.test(sql)) return { success: true, results: stmt.all(...args) }
            const r = stmt.run(...args); return { success: true, results: [], meta: { changes: Number(r.changes) } }
          },
          run: async () => { d1.calls++; if (d1.failing) throw new Error('D1 indisponible'); const r = stmt.run(...args); return { success: true, meta: { changes: Number(r.changes) } } },
          first: async () => { d1.calls++; if (d1.failing) throw new Error('D1 indisponible'); return stmt.get(...args) ?? null },
          all: async () => { d1.calls++; return { results: stmt.all(...args) } },
        }),
      }
    },
    /** Comme D1 : les requêtes liées s'exécutent dans une seule transaction (tout ou rien). `failAt` : rang de la requête qui échoue (test). */
    failAt: null,
    batch: async (stmts) => {
      d1.calls++
      if (d1.failing) throw new Error('D1 indisponible')
      db.exec('BEGIN')
      try {
        const out = stmts.map((s, n) => { if (n === d1.failAt) throw new Error('D1 : requête refusée'); return s.exec() })
        db.exec('COMMIT')
        return out
      } catch (e) { db.exec('ROLLBACK'); throw e }
    },
    exec: (sql) => db.exec(sql),
    raw: db,
  }
  return d1
}
