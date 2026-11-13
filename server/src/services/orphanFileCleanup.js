'use strict';
const fs = require('fs');
const { getDb, transaction } = require('../db');
const { safeResolve } = require('../utils/fileGuard');

const MAX_AGE_HOURS = 1;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/** Remove old uploaded files that have not been claimed by a saved invoice. */
function cleanupOrphanFiles() {
  const db = getDb();
  const removed = transaction(() => {
    const candidates = db.prepare(`SELECT f.id, f.rel_path, f.preview_rel_path
      FROM files f
      WHERE f.bound = 0
        AND f.created_at <= datetime('now', 'localtime', ?)
        AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.file_id = f.id)`)
      .all(`-${MAX_AGE_HOURS} hours`);
    const remove = db.prepare(`DELETE FROM files
      WHERE id = ? AND bound = 0
        AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.file_id = files.id)`);
    return candidates.filter((file) => remove.run(file.id).changes > 0);
  })();

  let deletedFiles = 0;
  for (const file of removed) {
    // Image previews can point to the same file as the original, so deduplicate paths.
    const paths = new Set([file.rel_path, file.preview_rel_path].filter(Boolean));
    for (const relativePath of paths) {
      const fullPath = safeResolve(relativePath);
      if (!fullPath) continue;
      try {
        if (fs.existsSync(fullPath)) {
          fs.rmSync(fullPath, { force: true });
          deletedFiles++;
        }
      } catch (error) {
        console.error(`[cleanup] unable to remove orphan file ${file.id}:`, error.message);
      }
    }
  }

  if (removed.length) console.log(`[cleanup] removed ${removed.length} unclaimed upload(s), ${deletedFiles} file(s)`);
  return { records: removed.length, files: deletedFiles };
}

function startOrphanFileCleanup() {
  const run = () => {
    try { cleanupOrphanFiles(); }
    catch (error) { console.error('[cleanup] orphan file cleanup failed:', error); }
  };
  run();
  const timer = setInterval(run, CLEANUP_INTERVAL_MS);
  timer.unref();
  return timer;
}

module.exports = { cleanupOrphanFiles, startOrphanFileCleanup };
