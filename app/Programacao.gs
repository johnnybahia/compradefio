/**
 * Programacao.gs
 * Tela "Programação de Embarque": lista sozinha, toda vez que é aberta, as
 * cores (itens da aba ESTOQUE) com saldo crítico — negativo ou abaixo do
 * limite desta unidade (CONFIG.UNIDADES[].limiteSaldoCritico: 20 no Ceará,
 * 10 na Bahia) — para o master/Programação preencherem a data que precisam
 * daquele embarque.
 *
 * Essa data é a nova fonte de DATA_LIMITE usada pela Análise de Compra (ver
 * `_criarLocalizadorDataLimite`, Analise.gs) — substitui a antiga planilha
 * PRIORIDADES DE FIO (importada nas colunas K/L de PEDIDO DE FIO), que não é
 * mais consultada.
 *
 * A lista não guarda histórico: quando uma cor deixa de estar em condição
 * crítica, sua linha (e a data preenchida) é apagada daqui — se ela voltar a
 * ficar crítica depois, reaparece na lista em branco, como uma necessidade nova.
 */

var PROGRAMACAO_DATA_EMBARQUE_HEADERS = ['ITEM', 'DATA_NECESSARIA', 'USUARIO', 'ATUALIZADO_EM'];

/**
 * Garante que a aba existe e trava a coluna ITEM em texto puro — senão o
 * Sheets converte sozinho um código "cru" (ex.: "5108/1") em data ao gravar
 * (mesma armadilha documentada em NOTAS.md; padrão já usado em
 * `_prepararAbaCompra`/`_prepararEmbarques`).
 */
function _prepararProgramacaoEmbarque() {
  var sh = _aba(CONFIG.SHEETS.PROGRAMACAO_DATA_EMBARQUE, PROGRAMACAO_DATA_EMBARQUE_HEADERS);
  sh.getRange(1, 1, sh.getMaxRows(), 1).setNumberFormat('@');
  return sh;
}

/** norm(item) → { item, dataNecessaria, usuario, atualizadoEm, row }. */
function _lerDatasProgramacao() {
  var mapa = {};
  lerRegistros(CONFIG.SHEETS.PROGRAMACAO_DATA_EMBARQUE).forEach(function (r) {
    var k = _norm(_itemDeCelula(r.ITEM));
    if (!k) return;
    mapa[k] = {
      item: _itemDeCelula(r.ITEM),
      dataNecessaria: _soData(r.DATA_NECESSARIA),
      usuario: _textoCelula(r.USUARIO),
      atualizadoEm: _dataHoraCelula(r.ATUALIZADO_EM),
      row: r.__row
    };
  });
  return mapa;
}

/** Saldo mais recente de cada item da aba ESTOQUE (mesmo critério de `listarItensParaAnalise`). */
function _saldoAtualPorItem() {
  var porItem = {};
  _lerEstoque().forEach(function (mov) {
    if (!mov.data) return;
    var chave = _norm(mov.item);
    if (!chave) return;
    if (!porItem[chave] || mov.data.getTime() > porItem[chave].data.getTime()) {
      porItem[chave] = { item: String(mov.item).trim(), data: mov.data, saldo: mov.saldo };
    }
  });
  return porItem;
}

/**
 * Lista as cores em condição crítica na unidade ativa, com a data já
 * preenchida (se houver), e limpa da aba PROGRAMACAO_DATA_EMBARQUE qualquer
 * cor que não está mais crítica — ver docstring do arquivo.
 * @return {Object} { ok, limite, itens: [{item, descricao, saldo, negativo, dataNecessaria}] }
 */
function listarCoresCriticas(token) {
  var s = exigirSessao(token, [CONFIG.PAPEIS.MASTER, CONFIG.PAPEIS.PROGRAMACAO]);
  var limite = CONFIG.getUnidadeInfo(s.unidade).limiteSaldoCritico;
  _prepararProgramacaoEmbarque();

  var porItem = _saldoAtualPorItem();
  var descricaoDe = _criarLocalizadorDescricao();
  var salvas = _lerDatasProgramacao();

  var criticoSet = {};
  var itens = [];
  Object.keys(porItem).forEach(function (k) {
    var r = porItem[k];
    if (r.saldo >= limite) return;
    criticoSet[k] = true;
    var salvo = salvas[k];
    itens.push({
      item: r.item,
      descricao: descricaoDe(r.item).descricao,
      saldo: r.saldo,
      negativo: r.saldo < 0,
      dataNecessaria: salvo ? salvo.dataNecessaria : ''
    });
  });
  itens.sort(function (a, b) { return a.saldo - b.saldo; });

  // Limpa cores que saíram da condição crítica desde a última leitura.
  var chaves = Object.keys(salvas);
  var restantes = chaves.filter(function (k) { return criticoSet[k]; }).map(function (k) { return salvas[k]; });
  if (restantes.length !== chaves.length) {
    reescreverAba(CONFIG.SHEETS.PROGRAMACAO_DATA_EMBARQUE, PROGRAMACAO_DATA_EMBARQUE_HEADERS,
      restantes.map(function (l) { return [l.item, l.dataNecessaria, l.usuario, l.atualizadoEm]; }));
  }

  return { ok: true, limite: limite, itens: itens };
}

/**
 * Grava (ou apaga, se `data` vier vazio) a data que a Programação precisa
 * deste embarque, para a cor informada. Não valida se a cor ainda está em
 * condição crítica — quem decide isso é a lista (`listarCoresCriticas`); se
 * o saldo já tiver mudado, a próxima leitura da lista limpa a linha sozinha.
 * @param {string} data 'dd/MM/aaaa', ou '' para apagar.
 */
function salvarDataEmbarqueItem(token, item, data) {
  var s = exigirSessao(token, [CONFIG.PAPEIS.MASTER, CONFIG.PAPEIS.PROGRAMACAO]);
  item = String(item == null ? '' : item).trim();
  if (!item) throw new Error('Informe a cor.');
  data = String(data == null ? '' : data).trim();

  _prepararProgramacaoEmbarque();
  var linhaExistente = null;
  lerRegistros(CONFIG.SHEETS.PROGRAMACAO_DATA_EMBARQUE).forEach(function (r) {
    if (_norm(_itemDeCelula(r.ITEM)) === _norm(item)) linhaExistente = r.__row;
  });

  if (!data) {
    if (linhaExistente) _aba(CONFIG.SHEETS.PROGRAMACAO_DATA_EMBARQUE).deleteRow(linhaExistente);
    return { ok: true, apagado: true };
  }
  if (!_parseDataBR(data)) throw new Error('Data inválida (use dd/mm/aaaa).');

  if (linhaExistente) {
    atualizarCelula(CONFIG.SHEETS.PROGRAMACAO_DATA_EMBARQUE, linhaExistente, 'DATA_NECESSARIA', data);
    atualizarCelula(CONFIG.SHEETS.PROGRAMACAO_DATA_EMBARQUE, linhaExistente, 'USUARIO', s.usuario || '');
    atualizarCelula(CONFIG.SHEETS.PROGRAMACAO_DATA_EMBARQUE, linhaExistente, 'ATUALIZADO_EM', new Date());
  } else {
    acrescentarRegistro(CONFIG.SHEETS.PROGRAMACAO_DATA_EMBARQUE,
      { ITEM: item, DATA_NECESSARIA: data, USUARIO: s.usuario || '', ATUALIZADO_EM: new Date() },
      PROGRAMACAO_DATA_EMBARQUE_HEADERS);
  }
  return { ok: true };
}
