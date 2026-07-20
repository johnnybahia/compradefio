/**
 * Tingimento.gs
 * Converte o consumo/estoque de cada item em um pedido de tingimento, usando
 * as capacidades das máquinas do fornecedor (aba BASE TINGIMENTO).
 *
 * Regra do alvo (kg a tingir), validada com os exemplos do cliente:
 *   - saldo < 0  → alvo = MAX(2 × |saldo|, média)  (cobre o déficit, nunca menos que a média)
 *   - saldo ≥ 0  → alvo = média                    (repõe ~1 mês de consumo)
 *
 * Seleção de máquinas: escolhe capacidades (repetição permitida) cuja soma
 * fique o mais perto possível do alvo, usando o MENOR número de máquinas
 * (aceita um pouco a menos ou um pouco a mais — não precisa ser exato).
 */

/** Alvo em kg a ser coberto pelo tingimento. */
function _alvoTingimento(saldo, media) {
  saldo = Number(saldo) || 0;
  media = Number(media) || 0;
  if (saldo < 0) return Math.max(2 * Math.abs(saldo), media);
  return media;
}

/**
 * Escolhe as máquinas (com repetição) para cobrir o alvo.
 * @return {Object} { maquinas: [caps...], total }
 */
function _selecionarMaquinas(alvo, caps) {
  caps = caps.filter(function (c) { return c > 0; }).sort(function (a, b) { return a - b; });
  if (!caps.length || alvo <= 0) return { maquinas: [], total: 0 };

  var maxCap = caps[caps.length - 1];
  var Smax = Math.min(Math.ceil(alvo * 1.2) + maxCap, 200000);
  var dp = new Array(Smax + 1).fill(Infinity);
  var par = new Array(Smax + 1).fill(-1);
  dp[0] = 0;
  for (var s = 1; s <= Smax; s++) {
    for (var i = 0; i < caps.length; i++) {
      var c = caps[i];
      if (s - c >= 0 && dp[s - c] + 1 < dp[s]) { dp[s] = dp[s - c] + 1; par[s] = c; }
    }
  }

  var tol = Math.max(alvo * 0.12, 0.5);
  var maxK = 0;
  for (var s2 = 0; s2 <= Smax; s2++) if (dp[s2] < Infinity && dp[s2] > maxK) maxK = dp[s2];

  var melhor = null;
  // Menor número de máquinas cujo total fique dentro da tolerância; entre eles, o mais próximo.
  for (var k = 1; k <= maxK && !melhor; k++) {
    var cand = null;
    for (var s = 1; s <= Smax; s++) {
      if (dp[s] !== k) continue;
      var err = Math.abs(s - alvo);
      if (err > tol) continue;
      if (!cand || err < cand.err || (err === cand.err && s >= alvo && cand.s < alvo)) {
        cand = { s: s, err: err };
      }
    }
    if (cand) melhor = cand;
  }
  if (!melhor) { // fallback: menor erro global, depois menos máquinas
    for (var s3 = 1; s3 <= Smax; s3++) {
      if (dp[s3] === Infinity) continue;
      var err3 = Math.abs(s3 - alvo);
      if (!melhor || err3 < melhor.err || (err3 === melhor.err && dp[s3] < dp[melhor.s])) {
        melhor = { s: s3, err: err3 };
      }
    }
  }
  if (!melhor) return { maquinas: [], total: 0 };

  var out = [];
  var cur = melhor.s;
  while (cur > 0) { var cc = par[cur]; if (cc <= 0) break; out.push(cc); cur -= cc; }
  out.sort(function (a, b) { return b - a; });
  return { maquinas: out, total: melhor.s };
}

/**
 * Lê a aba BASE TINGIMENTO. Cada linha com padrão (coluna A) vira
 * { patternNorm, tipoFio, caps:[...], minCap }.
 */
function _lerBaseTingimento() {
  var sh = _aba(CONFIG.SHEETS.BASE_TINGIMENTO);
  if (!sh) return [];
  var last = sh.getLastRow();
  if (last < 2) return [];
  var largura = Math.max(sh.getLastColumn(), 10);
  var vals = sh.getRange(1, 1, last, largura).getValues();
  var out = [];
  for (var r = 1; r < vals.length; r++) {      // pula o cabeçalho (linha 1)
    var pattern = vals[r][0];
    if (pattern === '' || pattern == null || String(pattern).trim() === '') continue; // linhas-rótulo (30 C, 36 C...)
    var caps = [];
    for (var c = 2; c < vals[r].length; c++) {
      var n = parseFloat(vals[r][c]);
      if (!isNaN(n) && n > 0) caps.push(n);
    }
    if (!caps.length) continue;
    out.push({
      patternNorm: _norm(pattern),
      tipoFio: vals[r][1] == null ? '' : String(vals[r][1]).trim(),
      caps: caps,
      minCap: Math.min.apply(null, caps)
    });
  }
  return out;
}

/**
 * Cria a calculadora de tingimento (lê a base uma vez).
 * Devolve uma função calc(item, saldo, media, emAberto) →
 *   { tipoFio, alvo, maquinas:[...], total }.
 * O tipo de fio é achado pelo padrão (mais longo) contido no código do item —
 * exceto o poliéster, que (diferente dos outros tipos) não tem sufixo no
 * código (ex.: "5233", "106"), então é usado como padrão-reserva quando o
 * código é só números e nenhum padrão mais específico bateu.
 *
 * `emAberto` é o quanto desse item JÁ está pedido, aguardando envio
 * (soma do SUGERIDO das linhas ainda pendentes em PENDENCIA_COMPRA) — é
 * descontado do alvo DEPOIS de aplicado o piso da média (diferente do
 * saldo físico/estoque encontrado, que nunca deixa o alvo cair abaixo da
 * média — ver `_alvoTingimento`). Já pedido e ainda não enviado pode, sim,
 * zerar a sugestão: não faz sentido pedir de novo o que já está na fila.
 */
function _criarCalculadoraTingimento() {
  var base = _lerBaseTingimento();
  var poliester = null;
  base.forEach(function (b) { if (b.patternNorm === 'poliester') poliester = b; });

  return function (item, saldo, media, emAberto) {
    var it = _norm(item);
    var achado = null;
    base.forEach(function (b) {
      if (b.patternNorm && it.indexOf(b.patternNorm) !== -1) {
        if (!achado || b.patternNorm.length > achado.patternNorm.length) achado = b;
      }
    });
    if (!achado && poliester && /^\d+$/.test(it)) achado = poliester;
    if (!achado) return { tipoFio: '', alvo: 0, maquinas: [], total: 0 };
    var alvoBruto = _alvoTingimento(saldo, media);
    var alvo = Math.max(alvoBruto - (Number(emAberto) || 0), 0);
    var sel = _selecionarMaquinas(alvo, achado.caps);
    return { tipoFio: achado.tipoFio, alvo: alvo, maquinas: sel.maquinas, total: sel.total };
  };
}
