import { setEditorContent } from './query-executor';
import { showToast } from './ui-helpers';

const SQL_KEYWORDS = [
  'SELECT','DISTINCT','FROM','WHERE','AND','OR','NOT','IN','EXISTS','BETWEEN','LIKE','IS','NULL',
  'JOIN','INNER','LEFT','RIGHT','FULL','OUTER','CROSS','ON','USING',
  'GROUP BY','ORDER BY','HAVING','LIMIT','OFFSET','UNION','ALL','EXCEPT','INTERSECT',
  'INSERT INTO','INSERT','INTO','VALUES','UPDATE','SET','DELETE FROM','DELETE',
  'CREATE TABLE','CREATE INDEX','CREATE VIEW','ALTER TABLE','DROP TABLE','DROP INDEX',
  'WITH','AS','CASE','WHEN','THEN','ELSE','END','CAST','COALESCE','NULLIF',
  'COUNT','SUM','AVG','MIN','MAX','UPPER','LOWER','TRIM','LENGTH','SUBSTRING',
  'ASC','DESC','RETURNING','PRIMARY KEY','FOREIGN KEY','REFERENCES','DEFAULT',
  'NOT NULL','UNIQUE','CHECK','INDEX','CONSTRAINT','BEGIN','COMMIT','ROLLBACK',
];

const BREAK_CLAUSES = [
  'SELECT','FROM','WHERE','GROUP BY','ORDER BY','HAVING','LIMIT','OFFSET',
  'INNER JOIN','LEFT JOIN','RIGHT JOIN','FULL JOIN','CROSS JOIN','JOIN',
  'UNION ALL','UNION','EXCEPT','INTERSECT','INSERT INTO','VALUES','UPDATE',
  'SET','DELETE FROM','WITH',
];

export function formatQuery(rawSql: string): string {
  if (!rawSql) return rawSql;

  let sql = rawSql;
  const sorted = [...SQL_KEYWORDS].sort((a, b) => b.length - a.length);
  for (const kw of sorted) {
    sql = sql.replace(new RegExp(`\\b${kw}\\b`, 'gi'), kw);
  }

  sql = sql.replace(/\s+/g, ' ').trim();

  const breakRe = new RegExp(
    `\\b(${BREAK_CLAUSES.map((k) => k.replace(/ /g, '\\s+')).join('|')})\\b`, 'g',
  );
  sql = sql.replace(breakRe, '\n$1');
  sql = sql.replace(/\b(AND|OR)\b/g, '\n  $1');
  return sql.replace(/^\n+/, '').trim();
}

export function formatAndApply(rawSql: string): void {
  const formatted = formatQuery(rawSql);
  if (formatted) {
    setEditorContent(formatted);
    showToast('Query formatted');
  }
}
