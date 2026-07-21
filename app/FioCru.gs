/**
 * FioCru.gs
 * Estoque de fio crú (fios recebidos por NF, ainda não tingidos) e sua baixa
 * conforme o tingimento vai consumindo cada tipo de fio.
 *
 * FIO_CRU_ENTRADAS: cada linha é um LOTE — uma NF pode ter várias linhas
 * (uma por tipo de fio, ex.: a mesma NF traz Poliéster e Brilhante).
 *
 * FIO_CRU_BAIXAS: histórico — uma linha por lote afetado em cada baixa (uma
 * baixa só pode virar 2+ linhas se ela "atravessar" de um lote pro outro).
 *
 * Regra da baixa (FIFO por DATA da NF, dentro do mesmo tipo de fio):
 *   - desconta do lote mais antigo com saldo > 0;
 *   - quando ele zera, passa pro próximo lote mais antigo do mesmo tipo;
 *   - se não houver NENHUM lote com saldo, continua descontando do ÚLTIMO
 *     lote (o mais recente) — pode ficar NEGATIVO; não trava o lançamento;
 *   - um lote NOVO nasce com o próprio saldo cheio, nunca herda o negativo
 *     de um lote anterior (o saldo de cada lote é sempre "sua própria
 *     quantidade menos suas próprias baixas", nada é somado entre lotes).
 * Lotes com SITUAÇÃO = CANCELADO nunca entram na conta.
 *
 * O tipo de fio do item confirmado vem do TIPO_FIO já identificado na
 * análise de compra (coluna TIPO_FIO de PENDENCIA_COMPRA) — a comparação
 * com o texto da aba FIO_CRU_ENTRADAS é por "contém" (normalizado), pra não
 * quebrar por uma pequena diferença de redação entre as duas planilhas
 * (ex.: "Poliester" vs "Fio Poliester").
 */

var FIO_CRU_ENTRADAS_HEADERS = ['TIPO_FIO', 'NF', 'FORNECEDOR', 'QUANTIDADE', 'PRECO_UNITARIO', 'DATA', 'SITUACAO'];
var FIO_CRU_BAIXAS_HEADERS = ['DATA_HORA', 'TIPO_FIO', 'NF', 'DATA_NF', 'ITEM', 'QUANTIDADE', 'SALDO_NF_APOS', 'USUARIO'];

/** Dois textos de tipo de fio "batem" se um contém o outro (normalizado). */
function _tipoFioBate(a, b) {
  var na = _norm(a), nb = _norm(b);
  if (!na || !nb) return false;
  return na.indexOf(nb) !== -1 || nb.indexOf(na) !== -1;
}

/** Chave de um lote: tipo de fio (como veio na aba) + nº da NF, normalizados. */
function _chaveLoteFioCru(tipoFio, nf) {
  var t = _norm(tipoFio);
  var n = _normNumero(nf) || _norm(nf);
  return t && n ? t + '|' + n : '';
}

/** Lê a aba FIO_CRU_ENTRADAS (um lote por linha). */
function _lerLotesFioCru() {
  return lerRegistros(CONFIG.SHEETS.FIO_CRU_ENTRADAS)
    .map(function (r) {
      return {
        linha: r.__row,
        tipoFio: r.TIPO_FIO == null ? '' : String(r.TIPO_FIO).trim(),
        nf: r.NF,
        fornecedor: r.FORNECEDOR == null ? '' : String(r.FORNECEDOR).trim(),
        quantidade: Number(r.QUANTIDADE) || 0,
        precoUnitario: Number(r.PRECO_UNITARIO) || 0,
        data: _parseData(r.DATA),
        situacao: r.SITUACAO == null ? '' : String(r.SITUACAO).trim(),
        cancelado: _norm(r.SITUACAO).indexOf('cancelado') !== -1,
        chave: _chaveLoteFioCru(r.TIPO_FIO, r.NF)
      };
    })
    .filter(function (l) { return l.chave; });
}

/** Soma de baixas já registradas por lote (chave = tipo de fio + NF). */
function _baixasPorLoteFioCru() {
  var mapa = {};
  lerRegistros(CONFIG.SHEETS.FIO_CRU_BAIXAS).forEach(function (r) {
    var k = _chaveLoteFioCru(r.TIPO_FIO, r.NF);
    if (!k) return;
    mapa[k] = (mapa[k] || 0) + (Number(r.QUANTIDADE) || 0);
  });
  return mapa;
}

/** Todos os lotes com o saldo atual já calculado (quantidade − baixas). */
function _saldosFioCru() {
  var baixas = _baixasPorLoteFioCru();
  return _lerLotesFioCru().map(function (l) {
    var baixado = baixas[l.chave] || 0;
    return {
      linha: l.linha, tipoFio: l.tipoFio, nf: l.nf, fornecedor: l.fornecedor,
      quantidade: l.quantidade, precoUnitario: l.precoUnitario, data: l.data,
      situacao: l.situacao, cancelado: l.cancelado, chave: l.chave,
      baixado: baixado, saldo: l.quantidade - baixado
    };
  });
}

/**
 * Dá baixa de `quantidade` no fio crú do tipo informado (ver regra no topo
 * do arquivo). Grava uma linha de histórico por lote afetado.
 * @return {Object} { ok, mensagem?, tipoFio, quantidade, lotes:[{nf,dataNf,quantidadeBaixada,saldoApos}] }
 */
function _baixarFioCru(tipoFio, quantidade, item, usuario) {
  tipoFio = String(tipoFio || '').trim();
  quantidade = Number(quantidade) || 0;
  if (!tipoFio) return { ok: false, mensagem: 'Item sem tipo de fio identificado — não é possível dar baixa no fio crú.' };
  if (quantidade <= 0) return { ok: false, mensagem: 'Informe uma quantidade tingida maior que zero.' };

  var todos = _saldosFioCru()
    .filter(function (l) { return !l.cancelado && _tipoFioBate(l.tipoFio, tipoFio); })
    .sort(function (a, b) {
      if (!a.data && !b.data) return 0;
      if (!a.data) return 1;
      if (!b.data) return -1;
      return a.data.getTime() - b.data.getTime();
    });
  if (!todos.length) {
    return { ok: false, mensagem: 'Nenhuma NF de "' + tipoFio + '" encontrada no estoque de fio crú.' };
  }

  var restante = quantidade;
  var porChave = {}; // chave -> total baixado nesta chamada
  todos.filter(function (l) { return l.saldo > 0; }).forEach(function (l) {
    if (restante <= 0) return;
    var desconto = Math.min(l.saldo, restante);
    porChave[l.chave] = (porChave[l.chave] || 0) + desconto;
    restante -= desconto;
  });
  // Nenhum lote com saldo (ou sobrou depois de esgotar todos): desconta o que
  // falta do ÚLTIMO lote (o mais recente), mesmo que fique negativo.
  if (restante > 0) {
    var ultimo = todos[todos.length - 1];
    porChave[ultimo.chave] = (porChave[ultimo.chave] || 0) + restante;
  }

  var agora = new Date();
  var linhas = [], resultado = [];
  Object.keys(porChave).forEach(function (chave) {
    var lote = todos.filter(function (l) { return l.chave === chave; })[0];
    var qtd = porChave[chave];
    var saldoApos = lote.saldo - qtd;
    linhas.push([agora, lote.tipoFio, lote.nf, lote.data || '', item || '', qtd, saldoApos, usuario || '']);
    resultado.push({ nf: lote.nf, dataNf: _soData(lote.data), quantidadeBaixada: qtd, saldoApos: saldoApos });
  });
  // Ordena o retorno pela mesma ordem FIFO (mais antiga primeiro), pra ficar
  // legível na tela/e-mail.
  resultado.sort(function (a, b) {
    return todos.map(function (l) { return l.nf; }).indexOf(a.nf) -
      todos.map(function (l) { return l.nf; }).indexOf(b.nf);
  });

  var sh = _aba(CONFIG.SHEETS.FIO_CRU_BAIXAS, FIO_CRU_BAIXAS_HEADERS);
  sh.getRange(sh.getLastRow() + 1, 1, linhas.length, FIO_CRU_BAIXAS_HEADERS.length).setValues(linhas);

  return { ok: true, tipoFio: tipoFio, quantidade: quantidade, lotes: resultado };
}

/**
 * Ajusta a baixa de fio crú de UM item para um NOVO total confirmado — usado
 * na Confirmação de Embarque, quando o valor lançado antes (na "quantidade
 * tingida") é revisado/corrigido nessa etapa final, que é quem manda de
 * verdade. Só desconta ou credita a DIFERENÇA entre o que já estava baixado
 * e o valor novo — nunca duplica a baixa original, e nunca edita/apaga uma
 * linha antiga do histórico (só acrescenta o ajuste).
 *   - diferença POSITIVA (valor novo é maior): desconta a mais, pelo mesmo
 *     FIFO de sempre (ver `_baixarFioCru`).
 *   - diferença NEGATIVA (valor novo é menor): credita de volta, desfazendo
 *     primeiro a baixa MAIS RECENTE deste item, depois a anterior, e assim
 *     por diante (LIFO) — como uma baixa negativa no histórico.
 * @return {Object} { ok, mensagem?, tipoFio, diferenca, lotes:[{nf,dataNf,quantidadeBaixada,saldoApos}] }
 */
function _ajustarBaixaFioCru(tipoFio, item, novoTotal, usuario) {
  item = String(item || '').trim();
  novoTotal = Number(novoTotal) || 0;
  var atual = _tingidoPorItem()[_norm(item)] || 0;
  var diferenca = novoTotal - atual;
  if (Math.abs(diferenca) < 0.001) return { ok: true, tipoFio: tipoFio, diferenca: 0, lotes: [] };

  if (diferenca > 0) {
    var baixa = _baixarFioCru(tipoFio, diferenca, item, usuario);
    if (!baixa.ok) return baixa;
    return { ok: true, tipoFio: baixa.tipoFio, diferenca: diferenca, lotes: baixa.lotes };
  }

  var porItem = lerRegistros(CONFIG.SHEETS.FIO_CRU_BAIXAS)
    .filter(function (r) { return _norm(r.ITEM) === _norm(item) && (Number(r.QUANTIDADE) || 0) > 0; })
    .sort(function (a, b) {
      var da = a.DATA_HORA instanceof Date ? a.DATA_HORA.getTime() : 0;
      var db = b.DATA_HORA instanceof Date ? b.DATA_HORA.getTime() : 0;
      return db - da; // mais recente primeiro
    });

  var restante = -diferenca;
  var agora = new Date();
  var linhas = [], resultado = [];
  for (var i = 0; i < porItem.length && restante > 0.001; i++) {
    var r = porItem[i];
    var credito = Math.min(Number(r.QUANTIDADE) || 0, restante);
    restante -= credito;
    var chaveLote = _chaveLoteFioCru(r.TIPO_FIO, r.NF);
    var loteAtual = _saldosFioCru().filter(function (l) { return l.chave === chaveLote; })[0];
    var saldoApos = (loteAtual ? loteAtual.saldo : 0) + credito;
    linhas.push([agora, r.TIPO_FIO, r.NF, r.DATA_NF, item, -credito, saldoApos, usuario || '']);
    resultado.push({ nf: r.NF, dataNf: _soData(r.DATA_NF), quantidadeBaixada: -credito, saldoApos: saldoApos });
  }
  if (linhas.length) {
    var sh = _aba(CONFIG.SHEETS.FIO_CRU_BAIXAS, FIO_CRU_BAIXAS_HEADERS);
    sh.getRange(sh.getLastRow() + 1, 1, linhas.length, FIO_CRU_BAIXAS_HEADERS.length).setValues(linhas);
  }
  return { ok: true, tipoFio: tipoFio, diferenca: diferenca, lotes: resultado };
}

/**
 * De quais NFs (lotes) de fio crú a baixa TOTAL de um item está vindo hoje,
 * com o saldo ATUAL de cada uma — usado no resumo da Confirmação de
 * Embarque. NF cuja contribuição pra este item já foi totalmente creditada
 * de volta (ver `_ajustarBaixaFioCru`) não aparece.
 */
function _nfsDoItem(item) {
  var porNf = {};
  lerRegistros(CONFIG.SHEETS.FIO_CRU_BAIXAS)
    .filter(function (r) { return _norm(r.ITEM) === _norm(item); })
    .forEach(function (r) {
      var k = _chaveLoteFioCru(r.TIPO_FIO, r.NF);
      if (!k) return;
      if (!porNf[k]) porNf[k] = { tipoFio: r.TIPO_FIO, nf: r.NF, total: 0 };
      porNf[k].total += Number(r.QUANTIDADE) || 0;
    });
  var saldos = _saldosFioCru();
  return Object.keys(porNf)
    .filter(function (k) { return porNf[k].total > 0.001; })
    .map(function (k) {
      var lote = saldos.filter(function (l) { return l.chave === k; })[0];
      return {
        nf: porNf[k].nf, dataNf: lote ? _soData(lote.data) : '',
        quantidadeDesteItem: porNf[k].total, saldoAtual: lote ? lote.saldo : null
      };
    });
}

/**
 * Lança a quantidade tingida de UM item: acha o tipo de fio dele (pela
 * lista pendente de compra, PENDENCIA_COMPRA) e dá baixa no fio crú.
 * Por ora, só o master usa esta tela (papéis por item ainda serão
 * definidos) — ver `exigirSessao`.
 * @param {Object} params { item, quantidade }
 */
function registrarQuantidadeTingida(token, params) {
  var s = exigirSessao(token, [CONFIG.PAPEIS.MASTER]);
  params = params || {};
  var item = String(params.item || '').trim();
  if (!item) throw new Error('Informe o item.');
  var quantidade = Number(params.quantidade);
  if (isNaN(quantidade) || quantidade <= 0) throw new Error('Quantidade tingida inválida.');

  var itemNorm = _norm(item);
  var regs = lerRegistros(CONFIG.SHEETS.PENDENCIA_COMPRA);
  var pendente = regs.filter(function (r) { return _norm(r.ITEM) === itemNorm; })[0];
  var tipoFio = pendente ? String(pendente.TIPO_FIO || '').trim() : '';
  if (!tipoFio) {
    throw new Error('Não achei o tipo de fio do item "' + item + '" na lista pendente — confira se ele ainda está lá.');
  }

  var baixa = _baixarFioCru(tipoFio, quantidade, item, s.usuario);
  if (!baixa.ok) throw new Error(baixa.mensagem);
  return { ok: true, tipoFio: baixa.tipoFio, quantidade: baixa.quantidade, lotes: baixa.lotes };
}

/**
 * Soma, por item (normalizado), quanto já foi lançado como "tingido" no
 * histórico de baixas do fio crú — usado pra mostrar na tela de Tingimento
 * quanto já foi confirmado tingido de cada item.
 */
function _tingidoPorItem() {
  var mapa = {};
  lerRegistros(CONFIG.SHEETS.FIO_CRU_BAIXAS).forEach(function (r) {
    var k = _norm(r.ITEM);
    if (!k) return;
    mapa[k] = (mapa[k] || 0) + (Number(r.QUANTIDADE) || 0);
  });
  return mapa;
}

/**
 * Lista os lotes de fio crú com saldo, pra tela de administração do
 * estoque (ver histórico, conferir saldos). Acessível só ao master por ora.
 */
function listarEstoqueFioCru(token) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER]);
  var linhas = _saldosFioCru().map(function (l) {
    return {
      linha: l.linha, tipoFio: l.tipoFio, nf: l.nf, fornecedor: l.fornecedor,
      quantidade: l.quantidade, precoUnitario: l.precoUnitario, data: _soData(l.data),
      situacao: l.situacao, saldo: l.saldo
    };
  }).sort(function (a, b) {
    if (a.tipoFio !== b.tipoFio) return a.tipoFio.localeCompare(b.tipoFio);
    return _parseData(a.data) - _parseData(b.data);
  });
  return { ok: true, linhas: linhas };
}

/** Histórico de baixas do fio crú (mais recente primeiro), pra tela de administração. */
function listarBaixasFioCru(token) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER]);
  var regs = lerRegistros(CONFIG.SHEETS.FIO_CRU_BAIXAS);
  var linhas = regs.map(function (r) {
    return {
      linha: r.__row,
      dataHora: r.DATA_HORA instanceof Date
        ? Utilities.formatDate(r.DATA_HORA, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm')
        : String(r.DATA_HORA || ''),
      tipoFio: r.TIPO_FIO, nf: r.NF, dataNf: _soData(r.DATA_NF), item: r.ITEM,
      quantidade: r.QUANTIDADE, saldoApos: r.SALDO_NF_APOS, usuario: r.USUARIO
    };
  }).reverse();
  return { ok: true, linhas: linhas };
}

/**
 * Cadastra manualmente uma NF (lote) nova de fio crú. Acessível só ao master
 * por ora — a leitura automática de PDF de NF fica para uma etapa futura.
 * @param {Object} params { tipoFio, nf, fornecedor, quantidade, precoUnitario, data:'yyyy-MM-dd' }
 */
function lancarNotaFioCru(token, params) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER]);
  params = params || {};
  var tipoFio = String(params.tipoFio || '').trim();
  var nf = String(params.nf || '').trim();
  var quantidade = Number(params.quantidade);
  var data = _parseDataISO(params.data);
  if (!tipoFio) throw new Error('Informe o tipo de fio.');
  if (!nf) throw new Error('Informe o número da NF.');
  if (isNaN(quantidade) || quantidade <= 0) throw new Error('Quantidade inválida.');
  if (!data) throw new Error('Data da NF inválida.');

  var sh = _aba(CONFIG.SHEETS.FIO_CRU_ENTRADAS, FIO_CRU_ENTRADAS_HEADERS);
  sh.getRange(sh.getLastRow() + 1, 1, 1, FIO_CRU_ENTRADAS_HEADERS.length).setValues([[
    tipoFio, nf, String(params.fornecedor || '').trim(), quantidade,
    Number(params.precoUnitario) || '', data, ''
  ]]);
  return { ok: true };
}

/**
 * Marca/desmarca uma NF de fio crú como CANCELADA (some da conta de saldo,
 * mas o histórico de baixas já feito nela continua registrado).
 */
function definirSituacaoFioCru(token, linha, cancelado) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER]);
  linha = parseInt(linha, 10);
  if (!linha || linha < 2) throw new Error('Linha inválida.');
  atualizarCelula(CONFIG.SHEETS.FIO_CRU_ENTRADAS, linha, 'SITUACAO', cancelado ? 'CANCELADO' : '');
  return { ok: true };
}

/**
 * MIGRAÇÃO ÚNICA — importa a planilha "FIOS CRÚ MARFIM CEARÁ - Entradas por
 * NF" pra dentro da aba FIO_CRU_ENTRADAS (unidade Ceará). Idempotente: pula
 * qualquer linha [tipo de fio + NF] que já exista, não duplica se rodar de
 * novo. Rode pelo editor do Apps Script (Executar → importarFioCruCearaInicial).
 */
function importarFioCruCearaInicial() {
  _definirUnidadeAtiva('CEARA');
  var dados = [
    ['Fio Poliester', '115411', 'ANTEX', 3006.51, 16.13, '27/01/2026', ''],
    ['Fio 102 Lavado', '158370', 'AVANTI', 1000.00, 12.18, '30/12/2025', ''],
    ['Fio 102 Lavado', '158372', 'AVANTI', 3970.00, 12.70, '30/12/2025', ''],
    ['Fio Alpina', '160169', 'AVANTI', 2000.00, 15.92, '19/01/2026', ''],
    ['Fio Alpina', '164797', 'AVANTI', 2000.00, 15.71, '24/02/2024', ''],
    ['Fio Alpina', '167001', 'AVANTI', 3000.00, 18.40, '11/03/2026', ''],
    ['Fio Alpina', '167155', 'AVANTI', 2500.00, 18.40, '12/03/2026', ''],
    ['Fio Helanca', '41928', 'AVANTI', 1522.80, 26.70, '16/12/2025', ''],
    ['Fio Helanca', '42807', 'AVANTI', 1015.20, 26.70, '23/03/2026', ''],
    ['Fio Alpina', '178741', 'AVANTI', 4000.00, 17.51, '29/06/2026', ''],
    ['Fio Alpina', '8190', 'KTR', 1587.60, 18.90, '24/02/2026', ''],
    ['Fio 102 Lavado', '364736', 'UNIFI', 4486.90, 12.20, '26/05/2026', ''],
    ['Fio Brilhante', '361333', 'UNIFI', 1022.34, 17.10, '25/03/2026', ''],
    ['Fio Brilhante', '263275', 'UNIFI', 1012.35, 17.10, '29/04/2026', ''],
    ['Fio Pet Reflexx', '358237', 'UNIFI', 1000.65, 17.38, '26/01/2026', ''],
    ['Fio Pet Reflexx', '358238', 'UNIFI', 1000.00, 17.38, '26/01/2026', ''],
    ['Fio Pet Reflexx', '359655', 'UNIFI', 3000.40, 17.38, '24/02/2026', ''],
    ['Fio Pet Reflexx', '361333', 'UNIFI', 2003.30, 17.38, '25/06/2026', ''],
    ['Fio Pet Reflexx', '363262', 'UNIFI', 2001.96, 18.56, '29/04/2026', ''],
    ['Fio Poliester', '359761', 'UNIFI', 3012.35, 16.73, '25/02/2026', ''],
    ['Fio Poliester', '361333', 'UNIFI', 4010.36, 16.73, '25/03/2026', ''],
    ['Fio Poliester', '363261', 'UNIFI', 5007.95, 17.95, '29/04/2026', ''],
    ['Fio Poliester', '364719', 'UNIFI', 3004.20, 17.95, '26/05/2026', ''],
    ['Fio Poliester', '366510', 'UNIFI', 4001.23, 17.58, '26/06/2026', 'CANCELADO'],
    ['Fio Poliester', '366574', 'UNIFI', 2922.28, 17.58, '26/06/2026', ''],
    ['Fio Polimp', '361333', 'UNIFI', 1649.90, 17.58, '25/03/2026', '']
  ];

  var existentes = {};
  _lerLotesFioCru().forEach(function (l) { existentes[l.chave] = true; });

  var novas = [];
  dados.forEach(function (linha) {
    var data = _parseDataBR(linha[5]);
    var chave = _chaveLoteFioCru(linha[0], linha[1]);
    if (existentes[chave]) return;
    existentes[chave] = true;
    novas.push([linha[0], linha[1], linha[2], linha[3], linha[4], data, linha[6]]);
  });

  if (novas.length) {
    var sh = _aba(CONFIG.SHEETS.FIO_CRU_ENTRADAS, FIO_CRU_ENTRADAS_HEADERS);
    sh.getRange(sh.getLastRow() + 1, 1, novas.length, FIO_CRU_ENTRADAS_HEADERS.length).setValues(novas);
  }
  var msg = novas.length + ' de ' + dados.length + ' lote(s) importado(s) (' +
    (dados.length - novas.length) + ' já existiam).';
  Logger.log(msg);
  return { importados: novas.length, jaExistiam: dados.length - novas.length };
}
