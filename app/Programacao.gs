/**
 * Programacao.gs
 * Tela "Programação de Embarque": lista sozinha, toda vez que é aberta, as
 * cores (itens da aba ESTOQUE que batem com algum tipo de fio da BASE
 * TINGIMENTO) com saldo crítico — negativo ou abaixo do limite desta unidade
 * (CONFIG.UNIDADES[].limiteSaldoCritico: 20 no Ceará, 10 na Bahia), já
 * descontado o que está embarcado e a caminho — para o master/Programação
 * preencherem a data que precisam daquele embarque.
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

/**
 * Trava de execução da aba PROGRAMACAO_DATA_EMBARQUE (mesmo padrão de
 * `_travaEmbarque`, em Embarque.gs). Evita duas gravações quase simultâneas
 * do MESMO item novo criarem linhas duplicadas, e evita que a limpeza feita
 * por `listarCoresCriticas` reescreva a aba por cima de uma gravação
 * concorrente de `salvarDataEmbarqueItem`.
 */
function _travaProgramacaoEmbarque() {
  var lock = LockService.getScriptLock();
  var pegou = false;
  try { pegou = lock.tryLock(15000); } catch (e) { pegou = false; }
  if (!pegou) {
    throw new Error('Muita gente mexendo na Programação de Embarque agora. Tente de novo em alguns segundos.');
  }
  return lock;
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
  // O que já está embarcado e a caminho conta a favor do saldo — mesmo
  // critério da Análise de Compra ("soma ao saldo pra não pedir compra à
  // toa"; ver `listarItensParaAnalise`, Analise.gs) — senão uma cor que já
  // tem reposição chegando aparece como crítica à toa aqui.
  var emViagem = _emViagemPorItem();
  var tipoFioDe = _criarLocalizadorTipoFio();
  var descricaoDe = _criarLocalizadorDescricao();

  var criticoSet = {};
  var base = [];
  Object.keys(porItem).forEach(function (k) {
    var r = porItem[k];
    if (!tipoFioDe(r.item)) return; // não é uma cor de fio (ex.: código de outro controle)
    var saldoAjustado = r.saldo + (emViagem[k] || 0);
    if (saldoAjustado >= limite) return;
    criticoSet[k] = true;
    base.push({ chave: k, item: r.item, saldo: saldoAjustado, negativo: saldoAjustado < 0 });
  });

  // Datas já salvas. Se alguma cor salva não está mais crítica, limpa — mas
  // só entra na trava (e relê antes de escrever) quando isso é realmente
  // necessário, pra não serializar toda leitura da tela por causa de uma
  // limpeza que normalmente não acontece.
  var salvas = _lerDatasProgramacao();
  var chaves = Object.keys(salvas);
  var precisaLimpar = chaves.some(function (k) { return !criticoSet[k]; });
  if (precisaLimpar) {
    var lock = _travaProgramacaoEmbarque();
    try {
      salvas = _lerDatasProgramacao(); // relê: pode ter mudado entre a leitura acima e a trava
      chaves = Object.keys(salvas);
      var restantes = chaves.filter(function (k) { return criticoSet[k]; }).map(function (k) { return salvas[k]; });
      if (restantes.length !== chaves.length) {
        reescreverAba(CONFIG.SHEETS.PROGRAMACAO_DATA_EMBARQUE, PROGRAMACAO_DATA_EMBARQUE_HEADERS,
          restantes.map(function (l) { return [l.item, l.dataNecessaria, l.usuario, l.atualizadoEm]; }));
      }
      salvas = {};
      restantes.forEach(function (l) { salvas[_norm(l.item)] = l; });
    } finally {
      lock.releaseLock();
    }
  }

  var itens = base.map(function (b) {
    var salvo = salvas[b.chave];
    return {
      item: b.item,
      descricao: descricaoDe(b.item).descricao,
      saldo: b.saldo,
      negativo: b.negativo,
      dataNecessaria: salvo ? salvo.dataNecessaria : ''
    };
  });
  itens.sort(function (a, b) { return a.saldo - b.saldo; });

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
  if (data && !_parseDataBR(data)) throw new Error('Data inválida (use dd/mm/aaaa).');

  _prepararProgramacaoEmbarque();
  var lock = _travaProgramacaoEmbarque();
  try {
    var linhaExistente = null;
    lerRegistros(CONFIG.SHEETS.PROGRAMACAO_DATA_EMBARQUE).forEach(function (r) {
      if (_norm(_itemDeCelula(r.ITEM)) === _norm(item)) linhaExistente = r.__row;
    });

    if (!data) {
      if (linhaExistente) _aba(CONFIG.SHEETS.PROGRAMACAO_DATA_EMBARQUE).deleteRow(linhaExistente);
      return { ok: true, apagado: true };
    }

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
  } finally {
    lock.releaseLock();
  }
}
