// Поиск товара по коду: точное совпадение (код или штрихкод) первым, затем коды, начинающиеся с запроса
// (короче — выше, затем по алфавиту), затем коды, содержащие запрос.

export function searchProducts(products, query, limit = 50) {
  const q = query.trim();
  if (!q) return products.slice(0, limit);
  const exact = [], prefix = [], contains = [];
  for (const p of products) {
    if (p.code === q || (p.barcode && p.barcode === q)) exact.push(p);
    else if (p.code.startsWith(q)) prefix.push(p);
    else if (p.code.includes(q) || (p.barcode && p.barcode.startsWith(q))) contains.push(p);
  }
  const byCode = (a, b) => a.code.length - b.code.length || a.code.localeCompare(b.code);
  prefix.sort(byCode);
  contains.sort(byCode);
  return [...exact, ...prefix, ...contains].slice(0, limit);
}
