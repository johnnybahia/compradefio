/**
 * Tingimento.gs
 * Converte o consumo/estoque de cada item em um pedido de tingimento, usando
 * as capacidades das máquinas do fornecedor (aba BASE TINGIMENTO).
 *
 * Regra do alvo (kg a tingir), validada com os exemplos do cliente:
 *   - consumo médio ALTO (média mensal > 250 kg): não repõe 1 mês de uma vez.
 *     Trabalha por PRAZO em dias — começa mirando 15 dias e sobe de 5 em 5
 *     (15, 20, 25…) até que, depois de repor, sobre PELO MENOS 15 dias de
 *     consumo (`saldo + alvo ≥ consumo de 15 dias`). Assim cobre o déficit e
 *     mantém um piso de 15 dias, sem encher demais. Se o saldo já cobre 15+
 *     dias, alvo = 0 (nada a pedir).
 *   - demais casos (média ≤ 250 kg):
 *       - saldo < 0  → alvo = MAX(2 × |saldo|, média)  (cobre o déficit, nunca menos que a média)
 *       - saldo ≥ 0  → alvo = média                    (repõe ~1 mês de consumo)
 *
 * Seleção de máquinas: escolhe capacidades (repetição permitida) cuja soma
 * fique o mais perto possível do alvo, usando o MENOR número de máquinas
 * (aceita um pouco a menos ou um pouco a mais — não precisa ser exato).
 */

/** Consumo médio mensal (kg) acima do qual o alvo passa a trabalhar por prazo
 * em dias (base de 15 dias, subindo de 5 em 5) em vez de repor 1 mês inteiro. */
var LIMITE_CONSUMO_ALTO = 250;
/** Dias de consumo mínimos de base (piso) e passo de aumento do prazo. */
var DIAS_BASE_TINGIMENTO = 15;
var PASSO_DIAS_TINGIMENTO = 5;

/** Alvo em kg a ser coberto pelo tingimento (ver regra no topo do arquivo). */
function _alvoTingimento(saldo, media) {
  saldo = Number(saldo) || 0;
  media = Number(media) || 0;

  // Consumo alto: trabalha por prazo em dias (base 15, passo 5) até cobrir o
  // déficit e deixar pelo menos 15 dias de consumo em estoque.
  if (media > LIMITE_CONSUMO_ALTO) {
    var diario = media / 30;
    if (diario <= 0) return 0;
    var base = diario * DIAS_BASE_TINGIMENTO;   // consumo de 15 dias (piso)
    if (saldo >= base) return 0;                // já tem 15+ dias de base
    // Menor prazo (múltiplo de 5, começando em 15 dias) cujo consumo, somado
    // ao saldo, alcança os 15 dias de base.
    var diasNecessarios = (base - saldo) / diario;
    var passos = Math.ceil((diasNecessarios - DIAS_BASE_TINGIMENTO) / PASSO_DIAS_TINGIMENTO);
    var dias = DIAS_BASE_TINGIMENTO + Math.max(0, passos) * PASSO_DIAS_TINGIMENTO;
    return diario * dias;
  }

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
 *
 * Um item de um caso especial (ver `_casoEspecialTingimento`, em FioCru.gs —
 * ex.: "102 Lavado") calcula o alvo e escolhe as máquinas EMPRESTANDO a base
 * de outro tipo (ex.: poliéster), mesmo que não exista linha própria dele na
 * BASE TINGIMENTO — mas mantém o seu próprio tipo de fio, então a baixa no
 * estoque de fio crú continua saindo do lote com o nome dele ("Fio 102 Lavado").
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

    // Caso especial (ver `_casoEspecialTingimento`, em FioCru.gs): um item cujo
    // código é de um tipo que EMPRESTA a base de OUTRO tipo pra calcular o
    // pedido (ex.: "102 lavado" usa as máquinas do poliéster) — vale mesmo que
    // não exista linha própria dele na BASE TINGIMENTO. O tipo de fio do item
    // continua sendo o PRÓPRIO (caso.tipoFio), então a baixa no estoque de fio
    // crú sai do lote com esse nome ("Fio 102 Lavado"), não do poliéster.
    var caso = _casoEspecialTingimento(it);
    if (caso) {
      var baseEmprestada = null;
      base.forEach(function (b) { if (b.patternNorm === _norm(caso.baseTingimento)) baseEmprestada = b; });
      if (baseEmprestada) {
        var alvoCaso = Math.max(_alvoTingimento(saldo, media) - (Number(emAberto) || 0), 0);
        var selCaso = _selecionarMaquinas(alvoCaso, baseEmprestada.caps);
        return { tipoFio: caso.tipoFio, alvo: alvoCaso, maquinas: selCaso.maquinas, total: selCaso.total };
      }
    }

    if (!achado) return { tipoFio: '', alvo: 0, maquinas: [], total: 0 };
    var alvoBruto = _alvoTingimento(saldo, media);
    var alvo = Math.max(alvoBruto - (Number(emAberto) || 0), 0);
    var sel = _selecionarMaquinas(alvo, achado.caps);
    return { tipoFio: achado.tipoFio, alvo: alvo, maquinas: sel.maquinas, total: sel.total };
  };
}

/**
 * Lotes de tingimento (capacidades das máquinas da BASE TINGIMENTO) do tipo de
 * fio de um item — pra oferecer como opções de "quantidade prioritária" na
 * urgência. Usa a mesma regra de casamento da calculadora (padrão mais longo
 * no código; poliéster de reserva pra código só-número; caso especial empresta
 * a base de outro tipo). Devolve { tipoFio, lotes:[capacidades ordenadas] }.
 */
function _lotesTingimentoDoItem(item) {
  var base = _lerBaseTingimento();
  var poliester = null;
  base.forEach(function (b) { if (b.patternNorm === 'poliester') poliester = b; });
  var it = _norm(item);

  var caso = _casoEspecialTingimento(it);
  if (caso) {
    var emp = null;
    base.forEach(function (b) { if (b.patternNorm === _norm(caso.baseTingimento)) emp = b; });
    if (emp) return { tipoFio: caso.tipoFio, lotes: emp.caps.slice().sort(function (a, b) { return a - b; }) };
  }

  var achado = null;
  base.forEach(function (b) {
    if (b.patternNorm && it.indexOf(b.patternNorm) !== -1) {
      if (!achado || b.patternNorm.length > achado.patternNorm.length) achado = b;
    }
  });
  if (!achado && poliester && /^\d+$/.test(it)) achado = poliester;
  if (!achado) return { tipoFio: '', lotes: [] };
  return { tipoFio: achado.tipoFio, lotes: achado.caps.slice().sort(function (a, b) { return a - b; }) };
}

/** Lotes de tingimento disponíveis pro item (pro campo de quantidade da urgência). */
function obterLotesTingimentoItem(token, item) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER, CONFIG.PAPEIS.TINGIMENTO, CONFIG.PAPEIS.PROGRAMACAO]);
  var r = _lotesTingimentoDoItem(String(item == null ? '' : item));
  return { ok: true, tipoFio: r.tipoFio, lotes: r.lotes };
}
