/**
 * Consultas.gs
 * - obterListaTingimento: a lista que o tingimento trabalha (itens da relação
 *   de compra, só com Item, Descrição, Cliente, Máquinas e Total — sem expor
 *   o saldo/consumo do master).
 * - consultarHistoricoItem: histórico de um item, como está na aba ESTOQUE.
 */

/**
 * Lista para o painel de Tingimento (a partir da RELACAO_COMPRA gravada).
 * Acessível ao master e ao papel tingimento.
 */
function obterListaTingimento(token) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER, CONFIG.PAPEIS.TINGIMENTO]);
  var regs = lerRegistros(CONFIG.SHEETS.RELACAO_COMPRA);
  var linhas = regs.map(function (r) {
    return {
      linha: r.__row,
      item: r.ITEM,
      descricao: r.DESCRICAO,
      cliente: r.CLIENTE,
      maquinas: r.MAQUINAS,
      total: r.SUGERIDO,
      dataLimite: _formatarCelula(r.DATA_LIMITE),
      obs: r.OBS == null ? '' : String(r.OBS)
    };
  });
  return { ok: true, linhas: linhas };
}

/** Campos editáveis no painel de tingimento. */
var CAMPOS_TINGIMENTO_EDITAVEIS = ['OBS', 'DATA_LIMITE'];

/** Salva um campo editável do painel de tingimento (na RELACAO_COMPRA). */
function salvarCampoTingimento(token, linha, campo, valor) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER, CONFIG.PAPEIS.TINGIMENTO]);
  linha = parseInt(linha, 10);
  if (!linha || linha < 2) throw new Error('Linha inválida.');
  if (CAMPOS_TINGIMENTO_EDITAVEIS.indexOf(campo) === -1) throw new Error('Campo não editável: ' + campo);
  atualizarCelula(CONFIG.SHEETS.RELACAO_COMPRA, linha, campo, valor == null ? '' : String(valor));
  return { ok: true };
}

/**
 * Histórico de um item na aba ESTOQUE. Busca pelo nome do item (contém,
 * sem diferenciar acento/maiúscula) e devolve as linhas como estão na aba.
 * @return {Object} { ok, cabecalho: [...], linhas: [[...]], total, truncado }
 */
function consultarHistoricoItem(token, termo) {
  exigirSessao(token); // qualquer usuário autenticado pode consultar
  termo = String(termo == null ? '' : termo).trim();
  if (!termo) return { ok: true, cabecalho: [], linhas: [], total: 0, truncado: false };

  var sh = _aba(CONFIG.SHEETS.ESTOQUE);
  if (!sh) throw new Error('Aba "ESTOQUE" não encontrada.');
  var last = sh.getLastRow();
  if (last < 2) return { ok: true, cabecalho: [], linhas: [], total: 0, truncado: false };

  var vals = sh.getRange(1, 1, last, sh.getLastColumn()).getValues();
  var header = vals.shift();
  var normHeader = header.map(function (h) { return _norm(h); });
  var iItem = normHeader.indexOf('item');
  if (iItem < 0) iItem = 1; // fallback: coluna B

  var alvo = _norm(termo);
  var achadas = [];
  for (var r = 0; r < vals.length; r++) {
    var it = _norm(vals[r][iItem]);
    if (it && it.indexOf(alvo) !== -1) achadas.push(vals[r]);
  }

  var LIMITE = 1000;
  var truncado = achadas.length > LIMITE;
  if (truncado) achadas = achadas.slice(achadas.length - LIMITE); // as mais recentes

  var cabecalho = header.map(function (h, i) {
    var t = (h == null ? '' : String(h)).trim();
    return t || ('Col ' + (i + 1));
  });
  var linhas = achadas.map(function (row) { return row.map(_formatarCelula); });

  return { ok: true, cabecalho: cabecalho, linhas: linhas, total: linhas.length, truncado: truncado };
}

/** Formata valores de célula para exibição (datas em dd/MM/aaaa HH:mm:ss). */
function _formatarCelula(v) {
  if (v instanceof Date) {
    return isNaN(v.getTime())
      ? ''
      : Utilities.formatDate(v, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss');
  }
  return v == null ? '' : v;
}
