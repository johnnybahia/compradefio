/**
 * Consultas.gs
 * - obterListaTingimento: a lista que o tingimento trabalha (itens da relação
 *   de compra, só com Item, Descrição, Cliente, Máquinas e Total — sem expor
 *   o saldo/consumo do master).
 * - consultarHistoricoItem: histórico de um item, como está na aba ESTOQUE.
 */

/** Um registro do rascunho pendente (PENDENCIA_COMPRA) está em aberto (ainda não enviado). */
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
 * Lista para o painel de Tingimento (a partir do rascunho pendente,
 * PENDENCIA_COMPRA — ainda NÃO enviado por e-mail). O rascunho acumula
 * pedidos ao longo do tempo — aqui só entram os itens ainda EM ABERTO (o
 * tingimento pode não dar conta de tudo de uma vez). Acessível ao master e
 * ao papel tingimento.
 */
function obterListaTingimento(token) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER, CONFIG.PAPEIS.TINGIMENTO, CONFIG.PAPEIS.PROGRAMACAO]);
  var regs = _ordenarPorDataLimite(lerRegistros(CONFIG.SHEETS.PENDENCIA_COMPRA).filter(_emAberto));
  var linhas = regs.map(function (r) {
    return {
      linha: r.__row,
      item: r.ITEM,
      descricao: r.DESCRICAO,
      cliente: r.CLIENTE,
      maquinas: r.MAQUINAS,
      total: r.SUGERIDO,
      dataLimite: _soData(r.DATA_LIMITE),
      dataSolicitado: _soData(r.GERADO_EM),
      obs: r.OBS == null ? '' : String(r.OBS),
      saldoCritico: _saldoCritico(r)
    };
  });
  return { ok: true, linhas: linhas };
}

/**
 * O MESMO relatório que sai por e-mail (ver `_relatorioCompraHTML`,
 * `enviarRelatorioCompra`) — pra qualquer usuário ver direto no sistema, sem
 * precisar esperar/procurar o e-mail. Tela "Relatório", compartilhada por
 * todos os papéis (por isso sem restrição de papel aqui — qualquer sessão
 * válida serve).
 */
function obterRelatorioCompraAtual(token) {
  var s = exigirSessao(token);
  var regs = _ordenarPorDataLimite(lerRegistros(CONFIG.SHEETS.PENDENCIA_COMPRA).filter(_emAberto));
  // Previsão de chegada: para o item que tem embarque A CAMINHO, calcula em que
  // dia ele deve chegar na filial, pelos dias de recebimento configurados da
  // unidade (ver `_previsaoChegada`/`obterConfigChegada`, em Embarque.gs).
  var cfgChegada = _configChegadaUnidade();
  var emViagem = _embarquesEmViagemPorItem();
  var linhas = regs.map(function (r) {
    // Uma entrada por remessa a caminho (cada uma com sua data e quantidade).
    // Remessa parcial já recebida não aparece — ver `_embarquesEmViagemPorItem`.
    var remessas = (emViagem[_norm(r.ITEM)] || []).map(function (v) {
      var p = _previsaoChegada(v.data, cfgChegada.dias, cfgChegada.prazoDias);
      return {
        numero: v.numero,
        quantidade: v.quantidade,
        dataEmbarque: v.data ? _soData(v.data) : '',
        previsaoChegada: p ? _soData(p) : ''
      };
    });
    var totalViagem = remessas.reduce(function (a, v) { return a + (Number(v.quantidade) || 0); }, 0);
    return {
      linha: r.__row,
      dataSolicitado: _soData(r.GERADO_EM),
      item: r.ITEM,
      descricao: r.DESCRICAO,
      cliente: r.CLIENTE,
      maquinas: r.MAQUINAS,
      total: r.SUGERIDO,
      dataLimite: _soData(r.DATA_LIMITE),
      obs: r.OBS == null ? '' : String(r.OBS),
      saldoCritico: _saldoCritico(r),
      // Vazio quando não há nada a caminho (nem embarque, ou o parcial já chegou).
      remessas: remessas,
      emViagemQtd: totalViagem,
      status: 'pendente'
    };
  });

  // O item embarcado SAI da lista pendente na hora do lançamento do embarque
  // (regra do sistema — ver `_baixarPendenciaCompraPorEmbarque`), mas neste
  // relatório ele deve continuar aparecendo, com a previsão, até ser marcado
  // como CHEGOU. Então acrescenta os itens que estão a caminho e já não estão
  // mais na lista pendente. (Só o Relatório muda; a análise de compra e o
  // restante seguem como antes.)
  var jaListado = {};
  regs.forEach(function (r) { jaListado[_norm(r.ITEM)] = true; });
  var faltantes = Object.keys(emViagem).filter(function (k) { return !jaListado[k]; });
  if (faltantes.length) {
    var localizarDesc = _criarLocalizadorDescricao();
    var localizarData = _criarLocalizadorDataLimite();
    faltantes.forEach(function (k) {
      var lista = emViagem[k];
      if (!lista || !lista.length) return;
      var itemTxt = String(lista[0].item || '').trim();
      // O nome do item vem da própria aba EMBARQUES (coluna CORES).
      if (!itemTxt) return;
      var d = localizarDesc(itemTxt);
      var remessas = lista.map(function (v) {
        var p = _previsaoChegada(v.data, cfgChegada.dias, cfgChegada.prazoDias);
        return {
          numero: v.numero, quantidade: v.quantidade,
          dataEmbarque: v.data ? _soData(v.data) : '',
          previsaoChegada: p ? _soData(p) : ''
        };
      });
      var total = remessas.reduce(function (a, v) { return a + (Number(v.quantidade) || 0); }, 0);
      linhas.push({
        linha: 0, // não é linha de PENDENCIA_COMPRA (nada a editar aqui)
        dataSolicitado: '',
        item: itemTxt,
        descricao: d.descricao || '',
        cliente: d.cliente || '',
        maquinas: '',
        total: total,
        dataLimite: localizarData(itemTxt) || '',
        obs: '',
        saldoCritico: false,
        remessas: remessas,
        emViagemQtd: total,
        status: 'embarcado'
      });
    });
  }

  // Ordem final: primeiro os itens COM data de solicitação (o pedido em si),
  // e só depois os SEM data (os já embarcados, que não vêm da lista pendente) —
  // pra não misturar as duas coisas na leitura. Dentro de cada grupo, pela data
  // limite mais próxima, com quem não tem data por último (mesmo critério de
  // `_ordenarPorDataLimite`).
  linhas.sort(function (a, b) {
    var sa = a.dataSolicitado ? 0 : 1, sb = b.dataSolicitado ? 0 : 1;
    if (sa !== sb) return sa - sb;
    var da = _parseData(a.dataLimite), db = _parseData(b.dataLimite);
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return da.getTime() - db.getTime();
  });

  return {
    ok: true,
    numeroPedido: _numeroPedidoRelatorio(),
    dataPedido: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy'),
    // Horário de Fortaleza/Brasil sempre — fixo, não depende do fuso horário
    // configurado no projeto do Apps Script (Project Settings). Separado da
    // "Data" do pedido (que é só o dia) porque este é o instante em que a
    // TELA foi consultada, com hora e minuto.
    atualizadoEm: Utilities.formatDate(new Date(), 'America/Fortaleza', 'dd/MM/yyyy HH:mm'),
    unidadeRotulo: CONFIG.getUnidadeInfo(s.unidade).rotulo,
    // Dias de recebimento configurados (pra tela avisar quando faltar configurar).
    chegadaDias: cfgChegada.dias,
    chegadaPrazoDias: cfgChegada.prazoDias,
    chegadaRotulos: cfgChegada.dias.map(function (n) { return DIAS_SEMANA_ROTULO[n]; }),
    linhas: linhas
  };
}

/* ----------------------- E-mail / impressão ---------------------- */

/**
 * Propriedades do script que variam por unidade (e-mails de destino, número
 * do pedido) levam o id da unidade ativa no nome — assim Ceará e Bahia não
 * compartilham a mesma lista de e-mail nem a mesma numeração de pedido,
 * mesmo rodando no mesmo projeto/implantação.
 */
function _propUnidade(base) {
  return base + '_' + (_unidadeAtivaId || CONFIG.UNIDADE_PADRAO);
}

/** Devolve os e-mails de destino salvos (string, separados por ;). */
function obterDestinatarios(token) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER, CONFIG.PAPEIS.TINGIMENTO]);
  return { ok: true, emails: _destinatariosCompra() };
}

/** Salva os e-mails de destino (separados por ; ou ,). */
function salvarDestinatarios(token, emails) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER, CONFIG.PAPEIS.TINGIMENTO]);
  PropertiesService.getScriptProperties()
    .setProperty(_propUnidade('EMAILS_COMPRA'), String(emails == null ? '' : emails).trim());
  return { ok: true };
}

function _destinatariosCompra() {
  return PropertiesService.getScriptProperties().getProperty(_propUnidade('EMAILS_COMPRA')) || '';
}

/**
 * Número do PEDIDO DE FIO. Cada unidade tem seu próprio ponto de partida
 * (usado só enquanto a Propriedade do script NUMERO_PEDIDO_FIO_<UNIDADE>
 * não existir — depois disso quem manda é a propriedade). Pode ser ajustado
 * na mão na tela (ver `_numeroPedidoEscolhido`); só avança quando o e-mail
 * é EFETIVAMENTE enviado (`_definirNumeroPedido`, chamada só depois do
 * MailApp.sendEmail dar certo) — imprimir ou só abrir a tela não consome o
 * número; ele fica parado até o próximo envio.
 */
var NUMERO_PEDIDO_INICIAL_POR_UNIDADE = {
  CEARA: 784,
  BAHIA: 707
};
var NUMERO_PEDIDO_INICIAL_PADRAO = 1; // fallback p/ unidade sem valor definido acima

function _numeroPedidoAtual() {
  var unidade = _unidadeAtivaId || CONFIG.UNIDADE_PADRAO;
  var v = PropertiesService.getScriptProperties().getProperty(_propUnidade('NUMERO_PEDIDO_FIO'));
  var n = parseInt(v, 10);
  if (v && !isNaN(n)) return n;
  return NUMERO_PEDIDO_INICIAL_POR_UNIDADE.hasOwnProperty(unidade)
    ? NUMERO_PEDIDO_INICIAL_POR_UNIDADE[unidade]
    : NUMERO_PEDIDO_INICIAL_PADRAO;
}

/** Grava explicitamente o próximo número do pedido desta unidade. */
function _definirNumeroPedido(n) {
  PropertiesService.getScriptProperties().setProperty(_propUnidade('NUMERO_PEDIDO_FIO'), String(n));
}

/**
 * Número do ÚLTIMO pedido REALMENTE enviado por e-mail nesta unidade (ou
 * null se nenhum envio aconteceu ainda) — diferente de `_numeroPedidoAtual`,
 * que já é o PRÓXIMO número (reservado, ainda não usado). Usado pelas telas
 * que só exibem a lista (Relatório, Quantidade Tingida): elas mostram o
 * pedido que já foi mandado, e só trocam de número quando outro e-mail for
 * enviado de verdade — ver `_numeroPedidoRelatorio`.
 */
function _ultimoNumeroPedidoEnviado() {
  var v = PropertiesService.getScriptProperties().getProperty(_propUnidade('NUMERO_PEDIDO_FIO_ULTIMO_ENVIADO'));
  var n = parseInt(v, 10);
  return (v && !isNaN(n)) ? n : null;
}
function _definirUltimoNumeroPedidoEnviado(n) {
  PropertiesService.getScriptProperties().setProperty(_propUnidade('NUMERO_PEDIDO_FIO_ULTIMO_ENVIADO'), String(n));
}

/**
 * Número a exibir nas telas de leitura (Relatório, Quantidade Tingida): o do
 * último e-mail já enviado. Antes do primeiro envio desta unidade (nenhum
 * "último" ainda gravado), cai no próximo da sequência — não tem outro
 * número pra mostrar até o primeiro pedido realmente sair.
 */
function _numeroPedidoRelatorio() {
  var u = _ultimoNumeroPedidoEnviado();
  return u != null ? u : _numeroPedidoAtual();
}

/**
 * Número a usar no envio: o que o master digitou no campo (se for um
 * inteiro positivo válido) ou, na falta dele, o próximo da sequência
 * automática. Permite ajustar manualmente sem quebrar a numeração — o
 * próximo envio automático passa a contar a partir do número USADO agora,
 * seja ele manual ou automático (ver `enviarRelatorioCompra`).
 */
function _numeroPedidoEscolhido(numeroManual) {
  var n = parseInt(numeroManual, 10);
  if (numeroManual !== undefined && numeroManual !== null &&
      String(numeroManual).trim() !== '' && !isNaN(n) && n > 0) {
    return n;
  }
  return _numeroPedidoAtual();
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

/** Remove acentos preservando maiúsculas/minúsculas (usado no nome do arquivo do PDF). */
function _semAcento(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Envia a relação de compra (tingimento) por e-mail para os destinatários
 * salvos, em anexo um PDF no formato "PEDIDO DE FIO MARFIM <UNIDADE>" (com
 * data de emissão e número do pedido). O número só avança depois do envio
 * dar certo.
 *
 * O envio é só uma FOTO numerada do que está em aberto — NÃO remove nada de
 * PENDENCIA_COMPRA. A lista é um backlog vivo: um item só sai dela quando
 * dá baixa de verdade (embarque confirmado — ver `gravarEmbarque`, em
 * Embarque.gs — ou remoção manual, `removerItemPendente`), não quando é só
 * mencionado num e-mail. Cada envio tem seu próprio número sequencial, só
 * para controle/rastreio de qual pedido foi mandado quando.
 *
 * Retorna { ok, destinatarios, numero } ou lança erro claro.
 */
function enviarRelatorioCompra(token, numeroManual, dataFimAnalise) {
  var s = exigirSessao(token, [CONFIG.PAPEIS.MASTER, CONFIG.PAPEIS.TINGIMENTO]);
  var lista = _destinatariosCompra().split(/[;,]/)
    .map(function (e) { return e.trim(); })
    .filter(function (e) { return e && e.indexOf('@') !== -1; });
  if (!lista.length) {
    throw new Error('Informe pelo menos um e-mail de destino (separados por ;).');
  }
  var regs = _ordenarPorDataLimite(lerRegistros(CONFIG.SHEETS.PENDENCIA_COMPRA).filter(_emAberto));
  if (!regs.length) {
    throw new Error('Não há itens em aberto na relação de compra para enviar. Gere a compra primeiro.');
  }

  var unidade = CONFIG.getUnidadeInfo(s.unidade).rotulo.toUpperCase();
  var numero = _numeroPedidoEscolhido(numeroManual);
  var agora = new Date();
  var dataFmt = Utilities.formatDate(agora, Session.getScriptTimeZone(), 'dd/MM/yyyy');
  var html = _relatorioCompraHTML(regs, numero, dataFmt, unidade);
  var pdf = Utilities.newBlob(html, MimeType.HTML, 'pedido.html').getAs(MimeType.PDF)
    .setName('Pedido de Fio Marfim ' + _semAcento(unidade) + ' no ' + numero + '.pdf');

  var assunto = 'Pedido de Fio Marfim ' + unidade + ' nº ' + numero + ' - ' + dataFmt;
  MailApp.sendEmail({
    to: lista.join(','),
    subject: assunto,
    htmlBody: '<p style="font-family:Arial,Helvetica,sans-serif;color:#1c2733">Segue em anexo o Pedido ' +
      'de Fio Marfim ' + unidade + ' nº <b>' + numero + '</b>, emitido em <b>' + dataFmt + '</b>.</p>',
    attachments: [pdf]
  });
  // A partir daqui o e-mail já saiu — tudo que segue é só registro, não pode
  // mais dar erro "de negócio" (o pedido já foi feito de verdade). PENDENCIA_
  // COMPRA continua intacta: enviar é só uma foto numerada do que está em
  // aberto, não uma baixa (ver docstring acima).

  // Só agora — o e-mail já saiu. Avança a partir do número USADO (manual ou
  // automático), não do que estava salvo antes — é assim que um ajuste
  // manual "gruda" na sequência dali pra frente.
  _definirNumeroPedido(numero + 1);
  // Registra também como "último enviado" — é isso que as telas de leitura
  // (Relatório, Quantidade Tingida) mostram, pra não exibirem o próximo
  // número (ainda não usado) antes da hora.
  _definirUltimoNumeroPedidoEnviado(numero);
  // Guarda a data final da análise que gerou esse envio — a próxima Análise
  // de Compra já abre com "data inicial" nesse valor, pra continuar de onde
  // esta parou (ver `obterUltimaDataFimCompra`).
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(dataFimAnalise || ''))) {
    PropertiesService.getScriptProperties()
      .setProperty(_propUnidade('ULTIMA_DATA_FIM_COMPRA'), String(dataFimAnalise));
  }
  return { ok: true, destinatarios: lista.length, numero: numero };
}

/**
 * Data final da última análise cujo pedido foi efetivamente enviado por
 * e-mail (unidade atual) — usada pra pré-preencher a "data inicial" da
 * próxima Análise de Compra, continuando de onde a anterior parou.
 * @return {Object} { ok, data } — data em 'yyyy-MM-dd', ou '' se nunca houve envio.
 */
function obterUltimaDataFimCompra(token) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER]);
  var v = PropertiesService.getScriptProperties().getProperty(_propUnidade('ULTIMA_DATA_FIM_COMPRA'));
  return { ok: true, data: v || '' };
}

/**
 * Escolhe fonte, padding das células, tamanho do logo e do título conforme a
 * quantidade de linhas do relatório — quanto mais itens, mais compacto —, pra
 * tentar caber tudo numa única página A4 retrato. É um ajuste aproximado:
 * listas muito longas ainda podem passar para uma segunda página. Usado pelo
 * Pedido de Fio (`_relatorioCompraHTML`) e pela Confirmação de Embarque
 * (`_confirmacaoEmbarqueHTML`, em Embarque.gs).
 */
function _densidadeRelatorio(qtdLinhas) {
  if (qtdLinhas <= 28) return { fonte: 11, pad: '4px 6px', logo: 44, titulo: 16 };
  if (qtdLinhas <= 42) return { fonte: 9.5, pad: '3px 5px', logo: 36, titulo: 15 };
  if (qtdLinhas <= 60) return { fonte: 8, pad: '2px 4px', logo: 30, titulo: 14 };
  return { fonte: 7, pad: '1px 3px', logo: 26, titulo: 13 };
}

/** Estilo de página A4 retrato com margens pequenas (pro PDF caber melhor). */
function _cssPaginaRetrato() {
  return '<style>@page{size:A4 portrait;margin:8mm}body{margin:0}' +
    'table{border-collapse:collapse}</style>';
}

/** Monta o HTML do relatório de compra (usado no e-mail e no PDF anexado).
 * `unidade` é o rótulo da unidade (ex.: 'BAHIA') pro título — sem ele, o
 * título sai sem nome de unidade (nunca fixo no Ceará). Compacto e em retrato
 * (ver `_densidadeRelatorio`) pra caber numa página. */
function _relatorioCompraHTML(regs, numero, dataFmt, unidade) {
  var cols = [
    ['GERADO_EM', 'Solicitado em'],
    ['ITEM', 'Item'], ['DESCRICAO', 'Descrição'], ['CLIENTE', 'Cliente'],
    ['MAQUINAS', 'Máquinas'], ['SUGERIDO', 'Total (kg)'],
    ['DATA_LIMITE', 'Data limite'], ['OBS', 'Observação']
  ];
  var d = _densidadeRelatorio(regs.length);
  var thStyle = 'border:1px solid #cbd5e1;padding:' + d.pad + ';background:#0F5FA0;' +
    'color:#fff;text-align:left;font-size:' + d.fonte + 'px';
  var tdStyle = 'border:1px solid #cbd5e1;padding:' + d.pad + ';font-size:' + d.fonte + 'px';
  var th = cols.map(function (c) { return '<th style="' + thStyle + '">' + c[1] + '</th>'; }).join('');
  var rows = regs.map(function (r) {
    return '<tr>' + cols.map(function (c) {
      var v = (c[0] === 'DATA_LIMITE' || c[0] === 'GERADO_EM') ? _soData(r[c[0]]) : r[c[0]];
      if (v === '' || v == null) v = '';
      return '<td style="' + tdStyle + '">' + v + '</td>';
    }).join('') + '</tr>';
  }).join('');
  // CONFIG.LOGO_URL: URL externa fixa (ver Config.gs) — sem arquivo/base64
  // embutido; se o link não carregar, o e-mail só fica sem a imagem (alt).
  var tituloTxt = '<h1 style="color:#0B4576;margin:0 0 3px;font-size:' + d.titulo + 'px;letter-spacing:.02em">' +
    ('PEDIDO DE FIO MARFIM ' + (unidade || '')).trim() + '</h1>' +
    '<p style="margin:0;font-size:11px;color:#334155">Data: <b>' + dataFmt + '</b>' +
    ' &nbsp;&nbsp; Nº: <b>' + numero + '</b></p>';
  var cabecalho = '<table style="border-collapse:collapse;margin-bottom:8px"><tr>' +
    '<td style="padding:0 10px 0 0;vertical-align:middle">' +
      '<img src="' + CONFIG.LOGO_URL + '" alt="Marfim" style="height:' + d.logo + 'px;width:auto;display:block"></td>' +
    '<td style="vertical-align:middle">' + tituloTxt + '</td>' +
  '</tr></table>';
  return _cssPaginaRetrato() +
    '<div style="font-family:Arial,Helvetica,sans-serif;color:#1c2733">' +
    cabecalho +
    '<table style="border-collapse:collapse;width:100%;table-layout:auto">' +
    '<thead><tr>' + th + '</tr></thead><tbody>' + rows + '</tbody></table>' +
    '<p style="color:#64748b;font-size:9px;margin-top:8px">Enviado automaticamente pelo sistema Marfim.</p></div>';
}

/**
 * Marca itens como PRIORIDADE/URGENTE: grava a marcação na OBSERVAÇÃO de cada
 * item (somando ao que já houver, sem apagar) e dispara UM e-mail curto aos
 * mesmos destinatários da compra, listando os itens urgentes e a data desejada
 * (quando informada — NÃO altera a data limite original, é só pra sinalizar).
 * Usado pelo papel Programação e pelo master (botão dedicado "Enviar urgência"
 * na tela de Tingimento).
 * @param {Object} params { itens: [{linha, dataUrgencia}] }
 */
function enviarUrgenciaTingimento(token, params) {
  var s = exigirSessao(token, [CONFIG.PAPEIS.MASTER, CONFIG.PAPEIS.PROGRAMACAO]);
  params = params || {};
  var marcados = (params.itens || []).filter(function (it) { return it && it.linha; });
  if (!marcados.length) throw new Error('Marque ao menos um item como prioridade antes de enviar.');

  var lista = _destinatariosCompra().split(/[;,]/)
    .map(function (e) { return e.trim(); })
    .filter(function (e) { return e && e.indexOf('@') !== -1; });
  if (!lista.length) {
    throw new Error('Não há e-mails de destino configurados (mesma lista da tela de Tingimento).');
  }

  var porLinha = {};
  lerRegistros(CONFIG.SHEETS.PENDENCIA_COMPRA).forEach(function (r) { porLinha[r.__row] = r; });

  var detalhes = [];
  marcados.forEach(function (it) {
    var r = porLinha[it.linha];
    if (!r) return;
    var dataUrg = String(it.dataUrgencia == null ? '' : it.dataUrgencia).trim();
    var qtdUrg = Number(it.qtdUrgencia) || 0;
    var nota = 'URGENTE' + (qtdUrg > 0 ? ' ' + qtdUrg + ' kg' : '') +
      (dataUrg ? ' (prioridade para ' + dataUrg + ')' : '');
    var obsAtual = String(r.OBS == null ? '' : r.OBS).trim();
    var novaObs = obsAtual ? (obsAtual + ' | ' + nota) : nota;
    atualizarCelula(CONFIG.SHEETS.PENDENCIA_COMPRA, it.linha, 'OBS', novaObs);
    detalhes.push({ item: r.ITEM, descricao: r.DESCRICAO, cliente: r.CLIENTE, dataUrgencia: dataUrg, qtdUrgencia: qtdUrg });
  });
  if (!detalhes.length) throw new Error('Os itens marcados não foram encontrados (recarregue a tela e tente de novo).');

  var unidade = CONFIG.getUnidadeInfo(s.unidade).rotulo.toUpperCase();
  var dataFmt = Utilities.formatDate(new Date(), 'America/Fortaleza', 'dd/MM/yyyy HH:mm');
  MailApp.sendEmail({
    to: lista.join(','),
    subject: 'URGENTE · Prioridade de tingimento ' + unidade + ' — ' + detalhes.length + ' item(ns)',
    htmlBody: _urgenciaTingimentoHTML(detalhes, unidade, s.usuario, dataFmt)
  });
  return { ok: true, marcados: detalhes.length, destinatarios: lista.length };
}

/**
 * Cancela/limpa a marcação de URGENTE da observação de itens (tira os trechos
 * "URGENTE ..." da OBS, sem apagar o resto). Usado pelo master e Programação
 * pra desfazer uma urgência marcada por engano. Não "desenvia" o e-mail — só
 * limpa o registro na observação.
 * @param {Object} params { linhas: [numeroLinha, ...] }
 */
function limparUrgenciaTingimento(token, params) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER, CONFIG.PAPEIS.PROGRAMACAO]);
  params = params || {};
  var linhas = (params.linhas || []).map(function (n) { return parseInt(n, 10); }).filter(function (n) { return n; });
  if (!linhas.length) throw new Error('Nenhum item informado para limpar.');
  var porLinha = {};
  lerRegistros(CONFIG.SHEETS.PENDENCIA_COMPRA).forEach(function (r) { porLinha[r.__row] = r; });
  var limpos = 0;
  linhas.forEach(function (linha) {
    var r = porLinha[linha];
    if (!r) return;
    var obs = String(r.OBS == null ? '' : r.OBS);
    // Remove os trechos que começam com "URGENTE" (separados por " | ").
    var partes = obs.split(' | ').filter(function (p) {
      return p.trim().toUpperCase().indexOf('URGENTE') !== 0;
    });
    var nova = partes.join(' | ').trim();
    if (nova !== obs.trim()) {
      atualizarCelula(CONFIG.SHEETS.PENDENCIA_COMPRA, linha, 'OBS', nova);
      limpos++;
    }
  });
  return { ok: true, limpos: limpos };
}

/** HTML do e-mail de urgência (ver `enviarUrgenciaTingimento`). */
function _urgenciaTingimentoHTML(detalhes, unidade, autor, dataFmt) {
  function th(t) {
    return '<th style="border:1px solid #cbd5e1;padding:7px 9px;background:#B91C1C;' +
      'color:#fff;text-align:left;font-size:13px">' + t + '</th>';
  }
  function td(v) {
    return '<td style="border:1px solid #cbd5e1;padding:6px 9px;font-size:13px">' + v + '</td>';
  }
  var rows = detalhes.map(function (d) {
    return '<tr>' + td(_escHtmlEmail(d.item)) + td(_escHtmlEmail(d.descricao) || '—') +
      td(_escHtmlEmail(d.cliente) || '—') +
      td(Number(d.qtdUrgencia) > 0 ? (d.qtdUrgencia + ' kg') : '—') +
      td(d.dataUrgencia ? _escHtmlEmail(d.dataUrgencia) : '—') + '</tr>';
  }).join('');
  return '<div style="font-family:Arial,Helvetica,sans-serif;color:#1c2733">' +
    '<table style="border-collapse:collapse;margin-bottom:14px"><tr>' +
      '<td style="padding:0 14px 0 0;vertical-align:middle">' +
        '<img src="' + CONFIG.LOGO_URL + '" alt="Marfim" style="height:48px;width:auto;display:block"></td>' +
      '<td style="vertical-align:middle">' +
        '<h1 style="color:#B91C1C;margin:0 0 4px;font-size:20px">TINGIMENTO URGENTE — ' + unidade + '</h1>' +
        '<p style="margin:0;font-size:13px;color:#334155">Solicitado por <b>' + _escHtmlEmail(autor) +
          '</b> em ' + dataFmt + ' (horário de Fortaleza)</p></td>' +
    '</tr></table>' +
    '<p style="font-size:14px;margin:0 0 10px">Os itens abaixo são <b style="color:#B91C1C">prioridade</b> — ' +
      'favor priorizar o tingimento/entrega (a quantidade prioritária pode ser menor que o pedido total):</p>' +
    '<table style="border-collapse:collapse"><thead><tr>' +
      ['Item', 'Descrição', 'Cliente', 'Prioridade (kg)', 'Prioridade para'].map(th).join('') +
    '</tr></thead><tbody>' + rows + '</tbody></table>' +
    '<p style="color:#64748b;font-size:12px;margin-top:14px">Enviado automaticamente pelo sistema Marfim.</p></div>';
}

/** Campos editáveis no painel de tingimento. */
var CAMPOS_TINGIMENTO_EDITAVEIS = ['OBS', 'DATA_LIMITE'];

/** Salva um campo editável do painel de tingimento (na lista pendente,
 * PENDENCIA_COMPRA — enviar por e-mail não move nem trava esses campos). */
function salvarCampoTingimento(token, linha, campo, valor) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER, CONFIG.PAPEIS.TINGIMENTO]);
  linha = parseInt(linha, 10);
  if (!linha || linha < 2) throw new Error('Linha inválida.');
  if (CAMPOS_TINGIMENTO_EDITAVEIS.indexOf(campo) === -1) throw new Error('Campo não editável: ' + campo);
  atualizarCelula(CONFIG.SHEETS.PENDENCIA_COMPRA, linha, campo, valor == null ? '' : String(valor));
  return { ok: true };
}

/**
 * Remove manualmente UMA linha da lista pendente (PENDENCIA_COMPRA) — uso
 * típico: sobrou um resíduo pequeno depois de uma baixa automática por
 * embarque (ex.: pediu 50, chegaram 47, sobraram 3 — ver
 * `_baixarPendenciaCompraPorEmbarque`, em Embarque.gs) e o master decide que
 * não vale mais a pena esperar por aquele tanto. Ação pontual (uma linha só)
 * — para zerar a lista inteira, ver `excluirRelacaoDeCompra`.
 */
function removerItemPendente(token, linha) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER, CONFIG.PAPEIS.TINGIMENTO]);
  linha = parseInt(linha, 10);
  if (!linha || linha < 2) throw new Error('Linha inválida.');
  var regs = lerRegistros(CONFIG.SHEETS.PENDENCIA_COMPRA);
  var existe = regs.some(function (r) { return r.__row === linha; });
  if (!existe) throw new Error('Item não encontrado — a lista pode ter mudado, recarregue a tela.');

  var linhasFinais = regs
    .filter(function (r) { return r.__row !== linha; })
    .map(function (r) {
      return RELACAO_COMPRA_HEADERS.map(function (h) { return r[h] == null ? '' : r[h]; });
    });
  reescreverAba(CONFIG.SHEETS.PENDENCIA_COMPRA, RELACAO_COMPRA_HEADERS, linhasFinais);
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
