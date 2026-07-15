/**
 * Consultas.gs
 * - obterListaTingimento: a lista que o tingimento trabalha (itens da relação
 *   de compra, só com Item, Descrição, Cliente, Máquinas e Total — sem expor
 *   o saldo/consumo do master).
 * - consultarHistoricoItem: histórico de um item, como está na aba ESTOQUE.
 */

/** Um registro da RELACAO_COMPRA está em aberto (ainda não processado pelo tingimento). */
function _emAberto(r) {
  var s = _norm(r.STATUS);
  return !s || s === 'aberto'; // vazio conta como aberto (compatibilidade com pedidos antigos)
}

/**
 * Ordena os registros pela DATA_LIMITE (data limite de embarque) — a mais
 * próxima primeiro, para o tingimento priorizar quem embarca antes. Itens
 * sem data ficam por último (não são urgência de prazo). Usado tanto na
 * tela quanto no relatório (PDF/e-mail), para os dois seguirem a mesma ordem.
 */
function _ordenarPorDataLimite(regs) {
  return regs.slice().sort(function (a, b) {
    var da = _parseData(a.DATA_LIMITE);
    var db = _parseData(b.DATA_LIMITE);
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return da.getTime() - db.getTime();
  });
}

/** true quando o SALDO gravado no registro é negativo ou zero — usado só para
 * destacar a linha (não expõe o número em si, que continua fora desta tela). */
function _saldoCritico(r) {
  if (r.SALDO === '' || r.SALDO == null) return false;
  var n = Number(r.SALDO);
  return !isNaN(n) && n <= 0;
}

/**
 * Lista para o painel de Tingimento (a partir da RELACAO_COMPRA gravada).
 * A relação acumula pedidos ao longo do tempo — aqui só entram os itens
 * ainda EM ABERTO (o tingimento pode não dar conta de tudo de uma vez).
 * Acessível ao master e ao papel tingimento.
 */
function obterListaTingimento(token) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER, CONFIG.PAPEIS.TINGIMENTO]);
  var regs = _ordenarPorDataLimite(lerRegistros(CONFIG.SHEETS.RELACAO_COMPRA).filter(_emAberto));
  var linhas = regs.map(function (r) {
    return {
      linha: r.__row,
      item: r.ITEM,
      descricao: r.DESCRICAO,
      cliente: r.CLIENTE,
      maquinas: r.MAQUINAS,
      total: r.SUGERIDO,
      dataLimite: _soData(r.DATA_LIMITE),
      obs: r.OBS == null ? '' : String(r.OBS),
      saldoCritico: _saldoCritico(r)
    };
  });
  return { ok: true, linhas: linhas };
}

/* ----------------------- E-mail / impressão ---------------------- */

/** Devolve os e-mails de destino salvos (string, separados por ;). */
function obterDestinatarios(token) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER, CONFIG.PAPEIS.TINGIMENTO]);
  return { ok: true, emails: _destinatariosCompra() };
}

/** Salva os e-mails de destino (separados por ; ou ,). */
function salvarDestinatarios(token, emails) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER, CONFIG.PAPEIS.TINGIMENTO]);
  PropertiesService.getScriptProperties()
    .setProperty('EMAILS_COMPRA', String(emails == null ? '' : emails).trim());
  return { ok: true };
}

function _destinatariosCompra() {
  return PropertiesService.getScriptProperties().getProperty('EMAILS_COMPRA') || '';
}

/**
 * Número do PEDIDO DE FIO. Começa em 784 e só avança quando o e-mail é
 * EFETIVAMENTE enviado (_avancarNumeroPedido, chamada só depois do
 * MailApp.sendEmail dar certo) — imprimir ou só abrir a tela não consome o
 * número; ele fica parado até o próximo envio.
 */
var NUMERO_PEDIDO_INICIAL = 784;

function _numeroPedidoAtual() {
  var v = PropertiesService.getScriptProperties().getProperty('NUMERO_PEDIDO_FIO');
  var n = parseInt(v, 10);
  return (v && !isNaN(n)) ? n : NUMERO_PEDIDO_INICIAL;
}

function _avancarNumeroPedido() {
  PropertiesService.getScriptProperties().setProperty('NUMERO_PEDIDO_FIO', String(_numeroPedidoAtual() + 1));
}

/** Número do pedido pendente (sem consumir) e a data de hoje — para o cabeçalho
 * do relatório (impressão) antes mesmo de enviar o e-mail. */
function obterNumeroPedido(token) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER, CONFIG.PAPEIS.TINGIMENTO]);
  return {
    ok: true,
    numero: _numeroPedidoAtual(),
    data: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy')
  };
}

/**
 * Envia a relação de compra (tingimento) por e-mail para os destinatários
 * salvos, em anexo um PDF no formato "PEDIDO DE FIO MARFIM CEARÁ" (com data
 * de emissão e número do pedido). O número só avança depois do envio dar
 * certo. Retorna { ok, destinatarios, numero } ou lança erro claro.
 */
function enviarRelatorioCompra(token) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER, CONFIG.PAPEIS.TINGIMENTO]);
  var lista = _destinatariosCompra().split(/[;,]/)
    .map(function (e) { return e.trim(); })
    .filter(function (e) { return e && e.indexOf('@') !== -1; });
  if (!lista.length) {
    throw new Error('Informe pelo menos um e-mail de destino (separados por ;).');
  }
  var regs = _ordenarPorDataLimite(lerRegistros(CONFIG.SHEETS.RELACAO_COMPRA).filter(_emAberto));
  if (!regs.length) {
    throw new Error('Não há itens em aberto na relação de compra para enviar. Gere a compra primeiro.');
  }

  var numero = _numeroPedidoAtual();
  var agora = new Date();
  var dataFmt = Utilities.formatDate(agora, Session.getScriptTimeZone(), 'dd/MM/yyyy');
  var html = _relatorioCompraHTML(regs, numero, dataFmt);
  var pdf = Utilities.newBlob(html, MimeType.HTML, 'pedido.html').getAs(MimeType.PDF)
    .setName('Pedido de Fio Marfim Ceara no ' + numero + '.pdf');

  var assunto = 'Pedido de Fio Marfim Ceará nº ' + numero + ' - ' + dataFmt;
  MailApp.sendEmail({
    to: lista.join(','),
    subject: assunto,
    htmlBody: '<p style="font-family:Arial,Helvetica,sans-serif;color:#1c2733">Segue em anexo o Pedido ' +
      'de Fio Marfim Ceará nº <b>' + numero + '</b>, emitido em <b>' + dataFmt + '</b>.</p>',
    attachments: [pdf]
  });
  _avancarNumeroPedido(); // só agora — o e-mail já saiu
  return { ok: true, destinatarios: lista.length, numero: numero };
}

/** Monta o HTML do relatório de compra (usado no e-mail e no PDF anexado). */
function _relatorioCompraHTML(regs, numero, dataFmt) {
  var cols = [
    ['ITEM', 'Item'], ['DESCRICAO', 'Descrição'], ['CLIENTE', 'Cliente'],
    ['MAQUINAS', 'Máquinas'], ['SUGERIDO', 'Total (kg)'],
    ['DATA_LIMITE', 'Data limite'], ['OBS', 'Observação']
  ];
  var th = cols.map(function (c) {
    return '<th style="border:1px solid #cbd5e1;padding:7px 9px;background:#0F5FA0;' +
      'color:#fff;text-align:left;font-size:13px">' + c[1] + '</th>';
  }).join('');
  var rows = regs.map(function (r) {
    return '<tr>' + cols.map(function (c) {
      var v = (c[0] === 'DATA_LIMITE') ? _soData(r[c[0]]) : r[c[0]];
      if (v === '' || v == null) v = '';
      return '<td style="border:1px solid #cbd5e1;padding:6px 9px;font-size:13px">' + v + '</td>';
    }).join('') + '</tr>';
  }).join('');
  return '<div style="font-family:Arial,Helvetica,sans-serif;color:#1c2733">' +
    '<h1 style="color:#0B4576;margin:0 0 6px;font-size:20px;letter-spacing:.02em">PEDIDO DE FIO MARFIM CEARÁ</h1>' +
    '<p style="margin:0 0 16px;font-size:13px;color:#334155">Data: <b>' + dataFmt + '</b>' +
    ' &nbsp;&nbsp;&nbsp; Nº: <b>' + numero + '</b></p>' +
    '<table style="border-collapse:collapse">' +
    '<thead><tr>' + th + '</tr></thead><tbody>' + rows + '</tbody></table>' +
    '<p style="color:#64748b;font-size:12px;margin-top:14px">Enviado automaticamente pelo sistema Marfim.</p></div>';
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
  var iData = normHeader.indexOf('data');

  var alvo = _norm(termo);
  var achadas = [];
  for (var r = 0; r < vals.length; r++) {
    var it = _norm(vals[r][iItem]);
    if (it && it.indexOf(alvo) !== -1) achadas.push(vals[r]);
  }

  // Ordena da data mais recente para a mais antiga.
  if (iData >= 0) {
    achadas.sort(function (a, b) {
      var da = _parseData(a[iData]);
      var db = _parseData(b[iData]);
      return (db ? db.getTime() : -Infinity) - (da ? da.getTime() : -Infinity);
    });
  } else {
    achadas.reverse(); // sem coluna Data: assume ordem cronológica na planilha
  }

  var LIMITE = 1000;
  var truncado = achadas.length > LIMITE;
  if (truncado) achadas = achadas.slice(0, LIMITE); // já ordenado: as mais recentes

  var cabecalho = header.map(function (h, i) {
    var t = (h == null ? '' : String(h)).trim();
    return t || ('Col ' + (i + 1));
  });
  var linhas = achadas.map(function (row) { return row.map(_formatarCelula); });

  return { ok: true, cabecalho: cabecalho, linhas: linhas, total: linhas.length, truncado: truncado };
}

/**
 * Lista os itens distintos da aba ESTOQUE (para o autocomplete da consulta).
 * Usa cache de 30 min para não reler a aba a cada abertura da tela.
 */
function listarItensEstoque(token) {
  exigirSessao(token);
  var cache = CacheService.getScriptCache();
  var cached = cache.get('itensEstoque');
  if (cached) return { ok: true, itens: JSON.parse(cached) };

  var sh = _aba(CONFIG.SHEETS.ESTOQUE);
  if (!sh) return { ok: true, itens: [] };
  var last = sh.getLastRow();
  if (last < 2) return { ok: true, itens: [] };

  var vals = sh.getRange(1, 1, last, sh.getLastColumn()).getValues();
  var normHeader = vals.shift().map(function (h) { return _norm(h); });
  var iItem = normHeader.indexOf('item');
  if (iItem < 0) iItem = 1;

  var visto = {};
  vals.forEach(function (r) {
    var it = r[iItem];
    if (it === '' || it == null) return;
    var s = String(it).trim();
    if (s) visto[s] = true;
  });
  var itens = Object.keys(visto).sort(function (a, b) { return a.localeCompare(b); });
  try { cache.put('itensEstoque', JSON.stringify(itens), 1800); } catch (e) {}
  return { ok: true, itens: itens };
}

/** Extrai só a data (dd/MM/aaaa) de um Date/serial/texto; '' quando vazio. */
function _soData(v) {
  if (v === '' || v == null) return '';
  if (v instanceof Date) {
    return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, Session.getScriptTimeZone(), 'dd/MM/yyyy');
  }
  var s = String(v);
  var m = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return m[0];
  var iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[3] + '/' + iso[2] + '/' + iso[1];
  return s;
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
