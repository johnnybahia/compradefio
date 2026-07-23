/**
 * EstoqueUnidades.gs
 * Comparação de estoque ENTRE UNIDADES (só master).
 *
 * Objetivo: para cada item que a unidade ATIVA precisa comprar (lista pendente
 * do Pedido de Fio — PENDENCIA_COMPRA em aberto), mostrar o estoque da OUTRA
 * unidade (item equivalente, saldo atual e data do último saldo). Assim o
 * master vê se dá pra TRANSFERIR de uma unidade pra outra em vez de comprar.
 *
 * O casamento dos itens é em 3 níveis:
 *   1. Vínculo APRENDIDO (aba global EQUIVALENCIA_UNIDADES) — o master vinculou
 *      "item daqui ↔ item de lá" uma vez e vale pra sempre.
 *   2. Automático por CÓDIGO + TIPO DE FIO — as duas unidades usam o mesmo
 *      código de cor; só muda o jeito de escrever o sufixo (ex.: Ceará
 *      "4662/1 RECICLADO" x Bahia "4662 RECICLADO 1 CAB"). A normalização
 *      (`_chaveEquivItem`) resolve a maioria sozinha.
 *   3. Sem par → fica destacado pro master vincular na hora (vira regra).
 *
 * Só leitura da outra unidade (nada é gravado no estoque dela). A leitura
 * entre unidades usa `_ss(idDaPlanilha)` — a mesma base multiunidade do resto
 * do sistema (ver Db.gs / Config.gs).
 */

/** Id da outra unidade (a que não é a informada). Null se só houver uma. */
function _outraUnidade(id) {
  var outras = CONFIG.UNIDADES.filter(function (u) { return u.id !== id; });
  return outras.length ? outras[0].id : null;
}

/* --------------------- normalização p/ casar itens --------------------- */

/**
 * Código-base do item: o número NO COMEÇO do texto (sem zeros à esquerda),
 * ou '' se o item não começar com número. É de propósito só no começo — os
 * itens de fio são codificados pelo número no início ("39", "041",
 * "4662/1 RECICLADO", "5573 BRILHANTE"...), enquanto acessórios trazem o
 * número no meio ("TRAMADO ALXILIAR 39-GFX4X96", "CORREIA A41"). Pegar o
 * número em qualquer posição fazia acessório casar errado com fio.
 */
function _codigoBaseItem(item) {
  var m = String(item == null ? '' : item).match(/^\s*(\d+)/);
  return m ? String(parseInt(m[1], 10)) : '';
}

/**
 * Tipo de fio canônico deduzido do texto do item — para casar o mesmo produto
 * mesmo com sufixos escritos diferente entre as unidades. Mesma família de
 * regras usada na leitura do embarque (ver `_regrasSufixoEmbarque`).
 */
function _tipoCanonicoItem(item) {
  var s = _norm(item);
  if (s.indexOf('brilhante') !== -1) return 'BRILHANTE';
  if (s.indexOf('polimp') !== -1 || /\/p\b/.test(s)) return 'POLIMP';
  if (s.indexOf('reflex') !== -1 && s.indexOf('reciclado') !== -1) return 'REFLEX_RECIC';
  if (s.indexOf('reflex') !== -1) return 'REFLEX';
  if (s.indexOf('reciclado') !== -1 || s.indexOf('pet') !== -1 || /\/1\b/.test(s)) return 'RECICLADO';
  if (s.indexOf('lavado') !== -1) return 'LAVADO';
  if (s.indexOf('30-2') !== -1 || s.indexOf('30/2') !== -1 || s.indexOf('alpina') !== -1) return '30-2';
  return 'POLIESTER';
}

/** Chave de equivalência automática: código + tipo de fio canônico. */
function _chaveEquivItem(item) {
  var cod = _codigoBaseItem(item);
  return cod ? (cod + '|' + _tipoCanonicoItem(item)) : '';
}

/* --------------------- estoque atual da outra unidade ------------------- */

/**
 * Lê o ESTOQUE de uma unidade e devolve o ÚLTIMO saldo de cada item
 * (o do lançamento mais recente), em três formas:
 *   - porItem:  normalizado(item) → { item, saldo, data(Date|null) }
 *   - porChave: código+tipo       → { item, saldo, data(Date|null) }  (p/ o automático)
 *   - lista:    [{ item, saldo, data('dd/MM/aaaa') }]  (p/ o datalist de vincular)
 * Aceita os dois padrões de coluna (Ceará: Item/Data/Saldo; Bahia:
 * Descrição/Data Lançamento/Saldo de Estoque) — ver `_colPorNomes`.
 */
function _saldoPorItemUnidade(unidadeId) {
  var res = { porItem: {}, porChave: {}, lista: [] };
  var sh = _aba(CONFIG.SHEETS.ESTOQUE, null, _ss(CONFIG.getSpreadsheetId(unidadeId)));
  if (!sh) return res;
  var last = sh.getLastRow();
  if (last < 2) return res;

  var vals = sh.getRange(1, 1, last, sh.getLastColumn()).getValues();
  var header = vals.shift().map(_norm);
  var iItem = _colPorNomes(header, ['item', 'descricao']);
  var iData = _colPorNomes(header, ['data', 'data lancamento']);
  var iSaldo = _colPorNomes(header, ['saldo', 'saldo de estoque']);
  if (iItem < 0 || iSaldo < 0) return res;

  var ultimo = {}; // normalizado(item) -> { item, saldo, data }
  vals.forEach(function (r) {
    var raw = r[iItem];
    if (raw === '' || raw == null) return;
    if (raw instanceof Date) return; // célula que virou data (lixo) — ignora
    var item = String(raw).trim();
    if (!item) return;
    var data = iData >= 0 ? _parseData(r[iData]) : null;
    var saldo = parseFloat(r[iSaldo]);
    if (isNaN(saldo)) saldo = null;
    var k = _norm(item);
    var cur = ultimo[k];
    // fica com o lançamento de data mais recente; sem data, o de linha mais
    // abaixo (visto por último) vence.
    if (!cur || (data && (!cur.data || data.getTime() >= cur.data.getTime())) || (!cur.data && !data)) {
      ultimo[k] = { item: item, saldo: saldo, data: data };
    }
  });

  Object.keys(ultimo).forEach(function (k) {
    var reg = ultimo[k];
    res.porItem[k] = reg;
    var chave = _chaveEquivItem(reg.item);
    if (chave) {
      var ex = res.porChave[chave];
      if (!ex || (reg.data && (!ex.data || reg.data.getTime() > ex.data.getTime()))) {
        res.porChave[chave] = reg;
      }
    }
    res.lista.push({ item: reg.item, saldo: reg.saldo, data: reg.data ? _soData(reg.data) : '' });
  });
  res.lista.sort(function (a, b) { return a.item < b.item ? -1 : (a.item > b.item ? 1 : 0); });
  return res;
}

/* ------------------------- tabela de equivalência ----------------------- */

/** Planilha da aba global de equivalência (mesma ideia das outras universais). */
function _ssEquivalenciaUnidades() {
  var idFixo = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID_EQUIV_UNIDADES');
  return _ss(idFixo || CONFIG.getSpreadsheetId(CONFIG.UNIDADE_PADRAO));
}

/** Cabeçalho da aba: uma coluna de item por unidade (ITEM_CEARA, ITEM_BAHIA...). */
function _equivHeaders() {
  return CONFIG.UNIDADES.map(function (u) { return 'ITEM_' + u.id; });
}

/**
 * Garante a aba EQUIVALENCIA_UNIDADES com uma coluna por unidade — acrescenta
 * colunas que faltarem (ex.: uma unidade nova), sem apagar nada.
 */
function _prepararEquivalenciaUnidades() {
  var headers = _equivHeaders();
  var ss = _ssEquivalenciaUnidades();
  var sh = _aba(CONFIG.SHEETS.EQUIVALENCIA_UNIDADES, headers, ss);
  var largura = sh.getLastColumn();
  var atuais = largura ? sh.getRange(1, 1, 1, largura).getValues()[0].map(function (h) { return String(h).trim(); }) : [];
  headers.forEach(function (h) {
    if (atuais.indexOf(h) === -1) {
      atuais.push(h);
      sh.getRange(1, atuais.length).setValue(h)
        .setFontWeight('bold').setBackground('#0F5FA0').setFontColor('#FFFFFF');
    }
  });
  return sh;
}

/**
 * Mapa aprendido normalizado(item da unidade ATIVA) → item da unidade OUTRA
 * (string), lido da aba EQUIVALENCIA_UNIDADES. Só linhas com os dois lados
 * preenchidos.
 */
function _equivDe(unidadeAtiva, unidadeOutra) {
  _prepararEquivalenciaUnidades();
  var colA = 'ITEM_' + unidadeAtiva, colB = 'ITEM_' + unidadeOutra;
  var mapa = {};
  lerRegistros(CONFIG.SHEETS.EQUIVALENCIA_UNIDADES, _ssEquivalenciaUnidades()).forEach(function (r) {
    var a = r[colA], b = r[colB];
    if (a != null && String(a).trim() && b != null && String(b).trim()) {
      mapa[_norm(String(a).trim())] = String(b).trim();
    }
  });
  return mapa;
}

/* ------------------------------- API ------------------------------------ */

/**
 * Compara a lista pendente de compra da unidade ATIVA com o estoque da OUTRA
 * unidade. Só master. Já vem pronta (reflete o que está em aberto agora, logo
 * após a análise) — sem escolher período.
 * @return {Object} { ok, unidadeAtiva, unidadeOutra, atualizadoEm, itensOutra, linhas }
 */
function compararEstoqueEntreUnidades(token) {
  var s = exigirSessao(token, [CONFIG.PAPEIS.MASTER, CONFIG.PAPEIS.ALMOX1]);
  var ativa = s.unidade || CONFIG.UNIDADE_PADRAO;
  var outraId = _outraUnidade(ativa);
  if (!outraId) {
    return { ok: true, semOutraUnidade: true, unidadeAtiva: CONFIG.getUnidadeInfo(ativa).rotulo, linhas: [] };
  }

  var pendentes = _ordenarPorDataLimite(lerRegistros(CONFIG.SHEETS.PENDENCIA_COMPRA).filter(_emAberto));
  var estoqueOutra = _saldoPorItemUnidade(outraId);
  var aprendido = _equivDe(ativa, outraId);
  var agora = new Date();

  var linhas = pendentes.map(function (r) {
    var item = String(r.ITEM == null ? '' : r.ITEM).trim();
    var alvo = null, origem = '';
    var apr = aprendido[_norm(item)];
    if (apr) {
      alvo = estoqueOutra.porItem[_norm(apr)] || { item: apr, saldo: null, data: null };
      origem = 'aprendido';
    } else {
      var chave = _chaveEquivItem(item);
      if (chave && estoqueOutra.porChave[chave]) {
        alvo = estoqueOutra.porChave[chave];
        origem = 'automático';
      }
    }
    var dias = (alvo && alvo.data) ? Math.floor((agora.getTime() - alvo.data.getTime()) / 86400000) : null;
    return {
      linha: r.__row,
      item: item,
      descricao: r.DESCRICAO == null ? '' : String(r.DESCRICAO),
      tipoFio: r.TIPO_FIO == null ? '' : String(r.TIPO_FIO),
      saldoAqui: r.SALDO,
      saldoCriticoAqui: _saldoCritico(r),
      aComprar: r.SUGERIDO,
      dataLimite: _soData(r.DATA_LIMITE),
      itemOutra: alvo ? alvo.item : '',
      saldoOutra: alvo ? alvo.saldo : null,
      dataOutra: (alvo && alvo.data) ? _soData(alvo.data) : '',
      diasOutra: dias,
      origem: origem,
      semPar: !alvo
    };
  });

  return {
    ok: true,
    unidadeAtiva: CONFIG.getUnidadeInfo(ativa).rotulo,
    unidadeOutra: CONFIG.getUnidadeInfo(outraId).rotulo,
    atualizadoEm: Utilities.formatDate(agora, 'America/Fortaleza', 'dd/MM/yyyy HH:mm'),
    itensOutra: estoqueOutra.lista,
    linhas: linhas
  };
}

/**
 * Vincula (aprende) "item da unidade ativa ↔ item da outra unidade". Só master.
 * Se já existir linha com esse item da unidade ativa, atualiza; senão cria.
 */
function vincularItemEntreUnidades(token, itemAtivo, itemOutra) {
  var s = exigirSessao(token, [CONFIG.PAPEIS.MASTER, CONFIG.PAPEIS.ALMOX1]);
  itemAtivo = String(itemAtivo == null ? '' : itemAtivo).trim();
  itemOutra = String(itemOutra == null ? '' : itemOutra).trim();
  if (!itemAtivo || !itemOutra) throw new Error('Informe os dois itens para vincular.');
  var ativa = s.unidade || CONFIG.UNIDADE_PADRAO;
  var outraId = _outraUnidade(ativa);
  if (!outraId) throw new Error('Não há outra unidade configurada para comparar.');

  var colA = 'ITEM_' + ativa, colB = 'ITEM_' + outraId;
  _prepararEquivalenciaUnidades();
  var ss = _ssEquivalenciaUnidades();
  var existente = lerRegistros(CONFIG.SHEETS.EQUIVALENCIA_UNIDADES, ss).filter(function (r) {
    return _norm(r[colA]) === _norm(itemAtivo);
  })[0];

  if (existente) {
    atualizarCelula(CONFIG.SHEETS.EQUIVALENCIA_UNIDADES, existente.__row, colA, itemAtivo, ss);
    atualizarCelula(CONFIG.SHEETS.EQUIVALENCIA_UNIDADES, existente.__row, colB, itemOutra, ss);
  } else {
    var obj = {};
    obj[colA] = itemAtivo;
    obj[colB] = itemOutra;
    acrescentarRegistro(CONFIG.SHEETS.EQUIVALENCIA_UNIDADES, obj, _equivHeaders(), ss);
  }
  return { ok: true };
}
