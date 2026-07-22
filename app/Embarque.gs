/**
 * Embarque.gs
 * Lê um PDF de relatório de embarque, interpreta os itens e preenche a aba
 * EMBARQUES (A=item, B=quantidade/peso, C=nº embarque, D=data, E=situação vazia).
 *
 * Fluxo:
 *   1. analisarEmbarquePdf(token, base64) → extrai o texto, interpreta e devolve
 *      uma PRÉVIA (nº do doc, data e itens), marcando o que não reconheceu.
 *   2. O usuário confere/ajusta e chama gravarEmbarque(token, dados), que grava
 *      na aba EMBARQUES e memoriza as descrições novas (aprendizado).
 *
 * Regras de normalização (descrição do PDF → item do estoque), validadas com o
 * cliente. A base é fixa; descrições novas/variações são aprendidas.
 */

/**
 * Regras de sufixo por tipo de fio: cada uma lista as palavras-chave que
 * precisam aparecer TODAS na descrição (da mais específica para a mais
 * genérica — a primeira cujas palavras batem todas vence). A ordem importa:
 * "reflex" sozinho e "reflex"+"reciclado" juntos são produtos diferentes
 * ("Fio Reflexx cor X" vs "Fio Reciclado Reflexx cor X"), por isso a
 * combinação mais específica é checada antes da palavra isolada.
 */
function _regrasSufixoEmbarque() {
  return [
    { kws: ['brilhante'],           suf: ' BRILHANTE' },
    { kws: ['polimp'],              suf: '/P' },
    { kws: ['reflex', '1 cabo'],    suf: '/1 1 CABO' },          // ex.: "Fio Reflex 1 Cabo"
    { kws: ['reciclado', '1 cabo'], suf: ' RECICLADO 1 CABO' },  // ex.: "Fio Reciclado 1 Cabo"
    { kws: ['pet', '1 cabo'],       suf: ' RECICLADO 1 CABO' },  // ex.: "Fio Pet 1 Cabo" (sem a palavra "reciclado")
    { kws: ['reflex', 'reciclado'], suf: '/1 RECICLADO' },       // ex.: "Fio Reciclado Reflexx" (2 cabos)
    { kws: ['reflex'],              suf: '/1' },                 // ex.: "Fio Reflexx" puro (2 cabos)
    { kws: ['reciclado'],           suf: '/1 RECICLADO' },       // ex.: "Fio Reciclado" puro (2 cabos)
    { kws: ['lavado'],              suf: ' LAVADO' },
    { kws: ['30/2'],                suf: ' 30-2' },
    { kws: ['alpina'],              suf: ' 30-2' },
    { kws: ['poliester'],           suf: '' }
  ];
}

/** Remove zeros à esquerda do código da cor (ex.: "009" → "9"). */
function _codEmbarque(codigo) {
  return String(codigo).replace(/^0+/, '') || '0';
}

/**
 * Interpreta o texto do PDF de embarque.
 *
 * A conversão do PDF para texto (via Drive → Google Doc) NÃO preserva as
 * quebras de linha do relatório original: vários itens podem cair juntos
 * numa mesma linha de texto (separados só por espaço), e um item pode
 * ficar dividido em várias linhas. Por isso o texto inteiro é normalizado
 * (todo espaço em branco vira um espaço só) e os itens são extraídos com
 * uma busca global pelo padrão "cor CÓDIGO - caixas cx - peso", em vez de
 * depender de onde estão as quebras de linha.
 *
 * @return {Object} { doc, data, linhas: [{descricao, tipo, codigo, quantidade, caixas, peso}] }
 */
function _parseEmbarque(texto) {
  var normalizado = String(texto || '').replace(/\s+/g, ' ').trim();

  var md = normalizado.match(/n[°ºo]\s*(\d+)/i);
  var doc = md ? md[1] : '';

  // Remove a saudação fixa do relatório ("...que embarcou dia [data]") antes
  // de procurar os itens, para essa frase não ser confundida com o tipo do
  // 1º item; a data do embarque, quando presente no texto, vem logo ali.
  var corte = normalizado.match(/embarcou\s+dia\s*/i);
  var data = '', corpo = normalizado;
  if (corte) {
    var resto = normalizado.slice(corte.index + corte[0].length);
    var mdt = resto.match(/^(\d{2}\/\d{2}\/\d{4})/);
    if (mdt) { data = mdt[1]; resto = resto.slice(mdt[0].length); }
    corpo = resto;
  }

  // Remove o cabeçalho fixo da tabela ("Descrição dos produtos Quantidade
  // Preço O.C <número>") quando ele vem colado antes do 1º item (sem quebra
  // de linha depois da normalização) — senão "O.C <número>" entra junto no
  // "tipo" do 1º item (a classe do grupo aceita dígitos e espaços). Só corta
  // se o cabeçalho aparecer ANTES da 1ª palavra "cor", pra nunca arriscar
  // cortar algo dentro da lista de itens de verdade.
  var primeiroCor = corpo.search(/\bcor\b/i);
  var mHeader = corpo.match(/o\.?c\.?\s*\d+\s*/i);
  if (mHeader && primeiroCor !== -1 && mHeader.index + mHeader[0].length <= primeiroCor) {
    corpo = corpo.slice(mHeader.index + mHeader[0].length);
  }

  var RE = /([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9\/ ]{0,24}?)\s*\bcor\s+([^\s\-–—_.]+)\s*[-–—_.]*\s*(\d+)\s*cx\s*[-–—_.]*\s*([\d.,]+)/gi;
  var out = [], m;
  while ((m = RE.exec(corpo)) !== null) {
    var peso = parseFloat(String(m[4]).replace(',', '.'));
    if (isNaN(peso)) peso = null;
    var tipo = m[1].trim();
    out.push({
      descricao: (tipo + ' cor ' + m[2]).replace(/\s+/g, ' '),
      tipo: tipo,
      codigo: m[2],
      caixas: parseInt(m[3], 10),
      peso: peso,
      quantidade: peso != null ? Math.floor(peso) : null
    });
  }
  return { doc: doc, data: data, linhas: out };
}

/** Extrai o texto de um PDF (base64) via conversão do Drive para Google Doc. */
function _extrairTextoPdf(base64, nome) {
  var bytes = Utilities.base64Decode(base64);
  var blob = Utilities.newBlob(bytes, 'application/pdf', nome || 'embarque.pdf');
  var doc = Drive.Files.insert(
    { title: 'tmp_embarque_' + Date.now(), mimeType: 'application/vnd.google-apps.document' },
    blob
  );
  var texto = '';
  try {
    texto = DocumentApp.openById(doc.id).getBody().getText();
  } finally {
    try { Drive.Files.remove(doc.id); } catch (e) {}
  }
  return texto;
}

/** Conjunto de itens do estoque: normalizado → valor original. */
function _itensEstoqueSet() {
  var sh = _aba(CONFIG.SHEETS.ESTOQUE);
  var set = {};
  if (!sh) return set;
  var last = sh.getLastRow();
  if (last < 2) return set;
  var vals = sh.getRange(1, 1, last, sh.getLastColumn()).getValues();
  var nh = vals.shift().map(function (h) { return _norm(h); });
  var i = _colPorNomes(nh, ['item', 'descricao']); if (i < 0) i = 1;
  vals.forEach(function (r) {
    var it = r[i];
    if (it === '' || it == null) return;
    var s = String(it).trim();
    if (s) set[_norm(s)] = s;
  });
  return set;
}

/** Aprendizado: normalizado(descrição) → item. */
function _lerMapaEmbarque() {
  var sh = _aba(CONFIG.SHEETS.MAPA_EMBARQUE);
  var mapa = {};
  if (!sh || sh.getLastRow() < 2) return mapa;
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
  vals.forEach(function (r) {
    var d = _norm(r[0]);
    if (d && r[1] !== '' && r[1] != null) mapa[d] = String(r[1]).trim();
  });
  return mapa;
}

/** Salva descrições aprendidas (descrição → item), sem duplicar. */
function _salvarMapaEmbarque(pares) {
  var existentes = _lerMapaEmbarque();
  var novos = [];
  pares.forEach(function (p) {
    if (!p.descricao || !p.item) return;
    var k = _norm(p.descricao);
    if (existentes[k]) return;
    existentes[k] = String(p.item).trim();
    novos.push([String(p.descricao).trim(), String(p.item).trim()]);
  });
  if (!novos.length) return;
  var sh = _aba(CONFIG.SHEETS.MAPA_EMBARQUE, ['DESCRICAO', 'ITEM']);
  sh.getRange(sh.getLastRow() + 1, 1, novos.length, 2).setValues(novos);
}

/**
 * Analisa um PDF de embarque e devolve a prévia para conferência.
 * @param {string} base64  conteúdo do PDF em base64 (sem o prefixo data:)
 */
function analisarEmbarquePdf(token, base64, nome) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER, CONFIG.PAPEIS.ALMOX1]);
  if (!base64) throw new Error('Nenhum arquivo recebido.');

  var texto = _extrairTextoPdf(base64, nome);
  var p = _parseEmbarque(texto);
  if (!p.linhas.length) {
    throw new Error('Não consegui ler itens neste PDF. Confira se é o relatório de embarque.');
  }

  var estoque = _itensEstoqueSet();
  var aprendido = _lerMapaEmbarque();
  var regras = _regrasSufixoEmbarque();

  var itens = p.linhas.map(function (l) {
    var chave = _norm(l.descricao);
    var item = '', ok = false, motivo = '';

    if (aprendido[chave]) {
      item = aprendido[chave]; ok = true; motivo = 'aprendido';
    } else {
      var suf = null, t = _norm(l.tipo);
      for (var i = 0; i < regras.length; i++) {
        var todasBatem = regras[i].kws.every(function (k) { return t.indexOf(k) !== -1; });
        if (todasBatem) { suf = regras[i]; break; }
      }
      if (suf) {
        var cand = _codEmbarque(l.codigo) + suf.suf;
        if (estoque[_norm(cand)]) { item = estoque[_norm(cand)]; ok = true; }
        else { item = cand; motivo = 'não encontrado no estoque'; }
      } else {
        motivo = 'descrição desconhecida';
      }
    }
    return {
      descricao: l.descricao, codigo: l.codigo,
      quantidade: l.quantidade, item: item, ok: ok, motivo: motivo
    };
  });

  return {
    ok: true,
    doc: p.doc,
    data: p.data,
    itens: itens,
    naoReconhecidos: itens.filter(function (i) { return !i.ok; }).length,
    textoBruto: texto
  };
}

var EMBARQUES_HEADERS = ['CORES', 'PESO', 'EMBARQUE', 'DATA', 'SITUAÇÃO'];

/**
 * Núcleo comum a QUALQUER confirmação de embarque: grava as linhas em
 * EMBARQUES e dá a baixa automática na lista pendente (PENDENCIA_COMPRA —
 * ver `_baixarPendenciaCompraPorEmbarque`). Usado tanto pelo PDF
 * (`gravarEmbarque`) quanto pelo lançamento manual direto nos itens
 * (`confirmarEmbarqueManual`) — as duas pontas fazem exatamente a mesma
 * coisa a partir daqui, só muda de onde vêm o item/quantidade.
 * @param {Array} itens [{item, quantidade}]
 * @param {number} doc  número do embarque
 * @param {Date} data
 * @return {Object} { gravados, baixados }
 */
function _registrarEmbarqueEDarBaixa(itens, doc, data) {
  var sh = _aba(CONFIG.SHEETS.EMBARQUES, EMBARQUES_HEADERS);
  var linhas = itens.map(function (it) {
    return [String(it.item).trim(), Number(it.quantidade) || 0, doc, data, ''];
  });
  sh.getRange(sh.getLastRow() + 1, 1, linhas.length, EMBARQUES_HEADERS.length).setValues(linhas);
  var baixa = _baixarPendenciaCompraPorEmbarque(itens);
  return { gravados: linhas.length, baixados: baixa.baixados };
}

/**
 * Grava o embarque conferido (lido de PDF) na aba EMBARQUES, memoriza as
 * descrições novas e dá baixa automática na lista pendente — ver
 * `_registrarEmbarqueEDarBaixa`.
 * @param {Object} dados { doc, data:'dd/MM/aaaa', itens:[{descricao,item,quantidade}] }
 */
function gravarEmbarque(token, dados) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER, CONFIG.PAPEIS.ALMOX1]);
  dados = dados || {};
  var doc = parseInt(dados.doc, 10);
  if (!doc) throw new Error('Informe o número do embarque.');
  var data = _parseDataBR(dados.data);
  if (!data) throw new Error('Data do embarque inválida (use dd/mm/aaaa).');

  var itens = (dados.itens || []).filter(function (it) { return it.item && String(it.item).trim(); });
  if (!itens.length) throw new Error('Nenhum item válido para gravar. Resolva os itens pendentes.');

  // Aprende as descrições resolvidas (para reconhecer nas próximas vezes).
  _salvarMapaEmbarque(itens.map(function (it) {
    return { descricao: it.descricao, item: it.item };
  }));

  var r = _registrarEmbarqueEDarBaixa(itens, doc, data);
  return { ok: true, gravados: r.gravados, baixados: r.baixados };
}

/**
 * Número do PRÓXIMO embarque lançado manualmente (sem PDF) — sequência
 * própria por unidade, pra não colidir com o número real de relatório de
 * transportadora usado no fluxo por PDF. Começa em 1.
 */
function _numeroEmbarqueManualAtual() {
  var v = PropertiesService.getScriptProperties().getProperty(_propUnidade('NUMERO_EMBARQUE_MANUAL'));
  var n = parseInt(v, 10);
  return (v && !isNaN(n)) ? n : 1;
}
function _avancarNumeroEmbarqueManual() {
  PropertiesService.getScriptProperties()
    .setProperty(_propUnidade('NUMERO_EMBARQUE_MANUAL'), String(_numeroEmbarqueManualAtual() + 1));
}

/**
 * Confirma manualmente um embarque, direto nos itens (sem PDF): faz
 * EXATAMENTE o que o fluxo do PDF faz — grava em EMBARQUES e dá baixa em
 * PENDENCIA_COMPRA (`_registrarEmbarqueEDarBaixa`) — só que o número do
 * embarque e a data são gerados agora (hoje), em vez de lidos do PDF.
 *
 * A quantidade aqui é a que MANDA de verdade: se o valor tiver sido editado
 * nesta tela em relação ao que foi lançado antes como "quantidade tingida",
 * a baixa do fio crú é AJUSTADA pra bater com o valor confirmado agora —
 * nunca soma os dois (ver `_ajustarBaixaFioCru`, em FioCru.gs). Esta
 * confirmação é o procedimento final: quem der certo aqui é o que sai do
 * estoque.
 *
 * Ao final, dispara um e-mail com a lista confirmada e um resumo por tipo
 * de fio (quanto foi tingido, de qual NF do fio crú saiu, e o saldo que
 * ficou nela).
 *
 * Por ora, só o master usa esta tela (papéis por item ainda serão
 * definidos) — ver `exigirSessao`.
 * @param {Object} params { itens: [{item, quantidade}] }
 * @return {Object} { ok, numero, gravados, baixados, resumo }
 */
function confirmarEmbarqueManual(token, params) {
  var s = exigirSessao(token, [CONFIG.PAPEIS.MASTER, CONFIG.PAPEIS.ALMOX1]);
  params = params || {};
  var itens = (params.itens || [])
    .filter(function (it) { return it.item && Number(it.quantidade) > 0; })
    .map(function (it) { return { item: String(it.item).trim(), quantidade: Number(it.quantidade) }; });
  if (!itens.length) throw new Error('Marque ao menos um item, com quantidade, para confirmar o embarque.');

  var lista = _destinatariosCompra().split(/[;,]/)
    .map(function (e) { return e.trim(); })
    .filter(function (e) { return e && e.indexOf('@') !== -1; });
  if (!lista.length) {
    throw new Error('Informe pelo menos um e-mail de destino (mesma lista da tela de Tingimento) antes de confirmar.');
  }

  var tipoFioPorItem = {};
  lerRegistros(CONFIG.SHEETS.PENDENCIA_COMPRA).forEach(function (r) {
    var k = _norm(r.ITEM);
    if (k && !tipoFioPorItem[k]) tipoFioPorItem[k] = String(r.TIPO_FIO || '').trim();
  });

  // Confirma (ou corrige) a baixa do fio crú de cada item pro valor que está
  // sendo confirmado agora, ANTES de gravar o embarque.
  var porTipo = {}; // tipoFio -> { tipoFio, totalTingido, nfs: {nf -> {...}} }
  itens.forEach(function (it) {
    var tipoFio = tipoFioPorItem[_norm(it.item)] || '';
    _ajustarBaixaFioCru(tipoFio, it.item, it.quantidade, s.usuario);
    var chaveTipo = tipoFio || '(tipo de fio não identificado)';
    if (!porTipo[chaveTipo]) porTipo[chaveTipo] = { tipoFio: chaveTipo, totalTingido: 0, nfs: {} };
    porTipo[chaveTipo].totalTingido += it.quantidade;
    _nfsDoItem(it.item).forEach(function (n) {
      porTipo[chaveTipo].nfs[String(n.nf)] = { nf: n.nf, dataNf: n.dataNf, saldoApos: n.saldoAtual };
    });
  });
  var resumo = Object.keys(porTipo).map(function (t) {
    var g = porTipo[t];
    return { tipoFio: g.tipoFio, totalTingido: g.totalTingido, nfs: Object.keys(g.nfs).map(function (nf) { return g.nfs[nf]; }) };
  });

  var numero = _numeroEmbarqueManualAtual();
  var agora = new Date();
  var r = _registrarEmbarqueEDarBaixa(itens, numero, agora);
  _avancarNumeroEmbarqueManual(); // só agora — o registro já foi gravado

  var unidade = CONFIG.getUnidadeInfo(s.unidade).rotulo.toUpperCase();
  var dataFmt = Utilities.formatDate(agora, Session.getScriptTimeZone(), 'dd/MM/yyyy');
  MailApp.sendEmail({
    to: lista.join(','),
    subject: 'Confirmação de Embarque ' + unidade + ' nº ' + numero + ' - ' + dataFmt,
    htmlBody: _confirmacaoEmbarqueHTML(itens, numero, dataFmt, resumo)
  });

  return { ok: true, numero: numero, gravados: r.gravados, baixados: r.baixados, resumo: resumo, destinatarios: lista.length };
}

/** Monta o HTML do e-mail de confirmação de embarque (lista + resumo por tipo de fio). */
function _confirmacaoEmbarqueHTML(itens, numero, dataFmt, resumo) {
  var thItens = ['Item', 'Quantidade (kg)'].map(function (t) {
    return '<th style="border:1px solid #cbd5e1;padding:7px 9px;background:#0F5FA0;' +
      'color:#fff;text-align:left;font-size:13px">' + t + '</th>';
  }).join('');
  var rowsItens = itens.map(function (it) {
    return '<tr>' +
      '<td style="border:1px solid #cbd5e1;padding:6px 9px;font-size:13px">' + it.item + '</td>' +
      '<td style="border:1px solid #cbd5e1;padding:6px 9px;font-size:13px">' + it.quantidade + '</td>' +
    '</tr>';
  }).join('');

  var resumoHtml = resumo.map(function (g) {
    var nfsTxt = g.nfs.length
      ? g.nfs.map(function (n) {
          return 'NF ' + n.nf + ' (' + (n.dataNf || '—') + ') — saldo restante: ' + n.saldoApos + ' kg';
        }).join('; ')
      : 'sem NF de fio crú associada (lance a quantidade tingida antes de confirmar o embarque)';
    return '<li style="margin-bottom:4px"><b>' + g.tipoFio + '</b>: ' + g.totalTingido + ' kg tingido — ' + nfsTxt + '</li>';
  }).join('');

  var logo = _logoDataUri();
  var tituloTxt = '<h1 style="color:#0B4576;margin:0 0 6px;font-size:20px;letter-spacing:.02em">' +
    'CONFIRMAÇÃO DE EMBARQUE</h1>' +
    '<p style="margin:0;font-size:13px;color:#334155">Data: <b>' + dataFmt + '</b>' +
    ' &nbsp;&nbsp;&nbsp; Nº: <b>' + numero + '</b></p>';
  var cabecalho = logo
    ? '<table style="border-collapse:collapse;margin-bottom:16px"><tr>' +
        '<td style="padding:0 14px 0 0;vertical-align:middle">' +
          '<img src="' + logo + '" style="height:56px;width:auto;display:block"></td>' +
        '<td style="vertical-align:middle">' + tituloTxt + '</td>' +
      '</tr></table>'
    : '<div style="margin-bottom:16px">' + tituloTxt + '</div>';

  return '<div style="font-family:Arial,Helvetica,sans-serif;color:#1c2733">' +
    cabecalho +
    '<table style="border-collapse:collapse">' +
    '<thead><tr>' + thItens + '</tr></thead><tbody>' + rowsItens + '</tbody></table>' +
    '<h3 style="color:#0B4576;margin:18px 0 8px;font-size:15px">Resumo por tipo de fio</h3>' +
    '<ul style="font-size:13px;color:#1c2733;margin:0 0 14px;padding-left:20px">' + resumoHtml + '</ul>' +
    '<p style="color:#64748b;font-size:12px;margin-top:14px">Enviado automaticamente pelo sistema Marfim.</p></div>';
}

/**
 * Baixa automática na lista pendente (PENDENCIA_COMPRA) com base no que
 * acabou de ser confirmado neste embarque: para cada item, desconta a
 * quantidade embarcada do(s) SUGERIDO pendente(s) mais antigo(s) primeiro
 * (FIFO por DATA_LIMITE — sem data limite fica por último, como já é a
 * ordem usada na tela de Tingimento — ver `_ordenarPorDataLimite`).
 *
 * Quando um pedido pendente é totalmente coberto pelo embarque, a linha sai
 * da lista. Se sobrar um resíduo (ex.: pediu 50, embarcaram 47 — sobram 3),
 * a linha fica com o SUGERIDO reduzido, pendente: não é apagada sozinha —
 * cabe ao master decidir se aquele resto ainda vale a pena, e removê-lo na
 * mão se não (ver `removerItemPendente`, em Consultas.gs).
 *
 * @param {Array} itens [{item, quantidade}] — os itens confirmados neste embarque.
 * @return {Object} { baixados } — nº de linhas de PENDENCIA_COMPRA afetadas (reduzidas ou removidas).
 */
function _baixarPendenciaCompraPorEmbarque(itens) {
  var restanteItem = {};
  itens.forEach(function (it) {
    var k = _norm(it.item);
    if (!k) return;
    restanteItem[k] = (restanteItem[k] || 0) + (Number(it.quantidade) || 0);
  });
  if (!Object.keys(restanteItem).length) return { baixados: 0 };

  var regs = lerRegistros(CONFIG.SHEETS.PENDENCIA_COMPRA);
  if (!regs.length) return { baixados: 0 };

  var porItem = {};
  regs.forEach(function (r) {
    var k = _norm(r.ITEM);
    if (!k || !restanteItem.hasOwnProperty(k)) return;
    if (!porItem[k]) porItem[k] = [];
    porItem[k].push(r);
  });

  var EPS = 0.01;
  var novoSugeridoPorLinha = {}; // __row -> novo valor
  var removidas = {};            // __row -> true
  var baixados = 0;

  Object.keys(porItem).forEach(function (k) {
    var lista = _ordenarPorDataLimite(porItem[k]);
    lista.forEach(function (r) {
      var qtd = restanteItem[k];
      if (qtd <= EPS) return;
      var sugerido = Number(r.SUGERIDO) || 0;
      if (sugerido <= 0) return;
      var desconto = Math.min(sugerido, qtd);
      var novoValor = sugerido - desconto;
      restanteItem[k] = qtd - desconto;
      baixados++;
      if (novoValor <= EPS) {
        removidas[r.__row] = true;
      } else {
        novoSugeridoPorLinha[r.__row] = novoValor;
      }
    });
  });
  if (!baixados) return { baixados: 0 };

  var linhasFinais = regs
    .filter(function (r) { return !removidas[r.__row]; })
    .map(function (r) {
      return RELACAO_COMPRA_HEADERS.map(function (h) {
        if (h === 'SUGERIDO' && novoSugeridoPorLinha.hasOwnProperty(r.__row)) {
          return novoSugeridoPorLinha[r.__row];
        }
        return r[h] == null ? '' : r[h];
      });
    });
  reescreverAba(CONFIG.SHEETS.PENDENCIA_COMPRA, RELACAO_COMPRA_HEADERS, linhasFinais);
  return { baixados: baixados };
}

/**
 * Lista os números dos últimos embarques lançados na aba EMBARQUES (um
 * embarque tem uma linha por item, aqui só o número aparece uma vez), do
 * mais recente para o mais antigo — para o usuário se localizar na tela de
 * Importar Embarque antes de importar um novo PDF (ex.: perceber que um
 * número ficou faltando na sequência).
 *
 * "Mais recente" é pela ORDEM DE LANÇAMENTO na aba (linha mais alta), não
 * pela data do embarque digitada — a data pode ter erro de digitação e
 * distorcer a ordem; a ordem de lançamento nunca mente.
 *
 * @param {number} limite  quantos números devolver — padrão 5.
 */
function listarUltimosEmbarques(token, limite) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER, CONFIG.PAPEIS.ALMOX1]);
  limite = parseInt(limite, 10) || 5;

  var sh = _aba(CONFIG.SHEETS.EMBARQUES);
  if (!sh || sh.getLastRow() < 2) return { ok: true, numeros: [] };

  var vals = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var header = vals.shift().map(_norm);
  var iEmbarque = header.indexOf('embarque'); if (iEmbarque < 0) iEmbarque = 2;

  var vistos = {}; // nº normalizado -> true (só a primeira ocorrência, de trás pra frente, importa)
  var numeros = [];
  for (var i = vals.length - 1; i >= 0 && numeros.length < limite; i--) {
    var numEmb = vals[i][iEmbarque];
    if (numEmb === '' || numEmb == null) continue;
    var chave = _normNumero(numEmb);
    if (!chave || vistos[chave]) continue;
    vistos[chave] = true;
    numeros.push(numEmb);
  }

  return { ok: true, numeros: numeros };
}

/**
 * Histórico dos embarques já confirmados (aba EMBARQUES — recebe tanto os
 * lançados por PDF quanto os manuais, ambos pela mesma `_registrarEmbarqueEDarBaixa`),
 * mais recente primeiro. Existe pra tela de Confirmar Embarque poder mostrar
 * o que já foi confirmado (e assim já saiu da lista de pendentes) sem
 * precisar manter esses itens ocupando espaço na lista principal.
 * @param {number} limite  quantas linhas devolver — padrão 200.
 */
function listarHistoricoEmbarquesConfirmados(token, limite) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER, CONFIG.PAPEIS.TINGIMENTO, CONFIG.PAPEIS.ALMOX1]);
  limite = parseInt(limite, 10) || 200;
  var regs = lerRegistros(CONFIG.SHEETS.EMBARQUES);
  var linhas = regs.map(function (r) {
    return {
      linha: r.__row,
      item: r.CORES,
      quantidade: Number(r.PESO) || 0,
      numero: r.EMBARQUE,
      data: _soData(r.DATA)
    };
  }).reverse().slice(0, limite);
  return { ok: true, linhas: linhas };
}

/** dd/MM/aaaa → Date (local), ou null. */
function _parseDataBR(s) {
  var m = String(s || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
}

/* -------------------- conciliação: embarque já chegou? ------------------- */
/**
 * Um item "em viagem" (embarcado mas ainda não chegado) continua contando
 * como parte do estoque para a análise de compra — só não deve ser somado
 * de novo depois que a mercadoria já foi lançada na aba ESTOQUE (senão o
 * saldo consideraria a mesma entrada duas vezes). Por isso, antes de gerar
 * a análise, o sistema confere se algum embarque pendente (coluna SITUAÇÃO
 * sem "chegou") já foi recebido: procura, na aba ESTOQUE, um lançamento no
 * mesmo período cuja coluna NF contenha o número do embarque (coluna
 * EMBARQUE) e cujo item bata — se achar, marca "CHEGOU" na aba EMBARQUES
 * (ela deixa de ser considerada em viagem a partir daí).
 */

/** Normaliza um número (célula) para comparação de texto, sem casas decimais/zeros à esquerda. */
function _normNumero(v) {
  if (v === '' || v == null) return '';
  var s = String(v).trim();
  if (!s) return '';
  var n = parseFloat(s.replace(',', '.'));
  return (!isNaN(n) && /^-?\d+([.,]\d+)?$/.test(s)) ? String(Math.round(n)) : s;
}

/**
 * Confere, dentro do período informado, quais embarques pendentes já foram
 * lançados na aba ESTOQUE (NF contém o nº do embarque + item confere) e
 * marca "CHEGOU" na aba EMBARQUES. Devolve { marcados }.
 */
function _atualizarChegadasEmbarque(inicio, fim) {
  var shEmb = _aba(CONFIG.SHEETS.EMBARQUES);
  if (!shEmb) return { marcados: 0 };
  var lastEmb = shEmb.getLastRow();
  if (lastEmb < 2) return { marcados: 0 };

  var valsEmb = shEmb.getRange(1, 1, lastEmb, shEmb.getLastColumn()).getValues();
  var headerEmb = valsEmb.shift().map(_norm);
  var iItemEmb = headerEmb.indexOf('cores'); if (iItemEmb < 0) iItemEmb = 0;
  var iEmbarque = headerEmb.indexOf('embarque'); if (iEmbarque < 0) iEmbarque = 2;
  var iSituacao = headerEmb.indexOf('situacao'); if (iSituacao < 0) iSituacao = 4;

  // Embarques ainda não marcados como chegados, agrupados pelo nº do embarque.
  var pendentes = {};
  valsEmb.forEach(function (row, i) {
    if (_norm(row[iSituacao]).indexOf('chegou') !== -1) return;
    var numEmb = _normNumero(row[iEmbarque]);
    if (!numEmb) return;
    if (!pendentes[numEmb]) pendentes[numEmb] = [];
    pendentes[numEmb].push({ linha: i + 2, itemNorm: _norm(row[iItemEmb]) });
  });
  var numeros = Object.keys(pendentes);
  if (!numeros.length) return { marcados: 0 };

  var shEst = _aba(CONFIG.SHEETS.ESTOQUE);
  if (!shEst) return { marcados: 0 };
  var lastEst = shEst.getLastRow();
  if (lastEst < 2) return { marcados: 0 };
  var valsEst = shEst.getRange(1, 1, lastEst, shEst.getLastColumn()).getValues();
  var headerEst = valsEst.shift().map(_norm);
  var iItemEst = _colPorNomes(headerEst, ['item', 'descricao']);
  var iDataEst = _colPorNomes(headerEst, ['data', 'data lancamento']);
  var iNfEst = _colPorNomes(headerEst, ['nf', 'nota fiscal/pedido']);
  if (iItemEst < 0 || iDataEst < 0 || iNfEst < 0) return { marcados: 0 };

  var linhasParaMarcar = {};
  valsEst.forEach(function (row) {
    var data = _parseData(row[iDataEst]);
    if (!data || data.getTime() < inicio.getTime() || data.getTime() > fim.getTime()) return;
    var nf = _normNumero(row[iNfEst]);
    if (!nf) return;
    var itemNorm = _norm(row[iItemEst]);
    numeros.forEach(function (numEmb) {
      if (nf.indexOf(numEmb) === -1) return; // NF precisa CONTER o nº do embarque
      pendentes[numEmb].forEach(function (p) {
        if (p.itemNorm === itemNorm) linhasParaMarcar[p.linha] = true;
      });
    });
  });

  var linhas = Object.keys(linhasParaMarcar);
  linhas.forEach(function (linha) {
    shEmb.getRange(parseInt(linha, 10), iSituacao + 1).setValue('CHEGOU');
  });
  return { marcados: linhas.length };
}

/**
 * Soma, por item (normalizado), a quantidade ainda "em viagem" na aba
 * EMBARQUES — isto é, embarcada mas cuja coluna SITUAÇÃO ainda não tem
 * "chegou". Deve ser chamada depois de _atualizarChegadasEmbarque, para já
 * refletir as chegadas confirmadas no período.
 */
function _emViagemPorItem() {
  var sh = _aba(CONFIG.SHEETS.EMBARQUES);
  var mapa = {};
  if (!sh) return mapa;
  var last = sh.getLastRow();
  if (last < 2) return mapa;

  var vals = sh.getRange(1, 1, last, sh.getLastColumn()).getValues();
  var header = vals.shift().map(_norm);
  var iItem = header.indexOf('cores'); if (iItem < 0) iItem = 0;
  var iPeso = header.indexOf('peso'); if (iPeso < 0) iPeso = 1;
  var iSituacao = header.indexOf('situacao'); if (iSituacao < 0) iSituacao = 4;

  vals.forEach(function (row) {
    var item = row[iItem];
    if (item === '' || item == null) return;
    if (_norm(row[iSituacao]).indexOf('chegou') !== -1) return; // já chegou: não conta mais
    var chave = _norm(item);
    mapa[chave] = (mapa[chave] || 0) + (parseFloat(row[iPeso]) || 0);
  });
  return mapa;
}

/* ------------------- pendências: embarque parcialmente lançado ------------------ */
/**
 * Quando ALGUNS itens de um mesmo nº de embarque já foram confirmados como
 * chegados (achados na aba ESTOQUE) mas OUTROS itens do mesmo embarque
 * ainda não, é sinal de que a mercadoria provavelmente já chegou por
 * inteiro — os itens que ficaram para trás podem ter sido esquecidos na
 * entrada do estoque, ou o número/código foi digitado errado. Esses itens
 * vão para a aba PENDÊNCIAS EMBARQUE para o master acompanhar; assim que o
 * item for encontrado no estoque (em qualquer análise futura), ele some
 * sozinho dessa lista.
 */
var PENDENCIAS_EMBARQUE_HEADERS = ['ITEM', 'EMBARQUE', 'QUANTIDADE', 'DATA_EMBARQUE', 'OBSERVACAO'];

/**
 * Recalcula a aba PENDÊNCIAS EMBARQUE a partir do estado atual da aba
 * EMBARQUES (chamar depois de _atualizarChegadasEmbarque). Devolve
 * { pendentes, linhas } — linhas para exibir de imediato na tela.
 */
function _atualizarPendenciasEmbarque() {
  var sh = _aba(CONFIG.SHEETS.EMBARQUES);
  if (!sh || sh.getLastRow() < 2) {
    reescreverAba(CONFIG.SHEETS.PENDENCIAS_EMBARQUE, PENDENCIAS_EMBARQUE_HEADERS, []);
    return { pendentes: 0, linhas: [] };
  }

  var vals = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var header = vals.shift().map(_norm);
  var iItem = header.indexOf('cores'); if (iItem < 0) iItem = 0;
  var iPeso = header.indexOf('peso'); if (iPeso < 0) iPeso = 1;
  var iEmbarque = header.indexOf('embarque'); if (iEmbarque < 0) iEmbarque = 2;
  var iData = header.indexOf('data'); if (iData < 0) iData = 3;
  var iSituacao = header.indexOf('situacao'); if (iSituacao < 0) iSituacao = 4;

  var grupos = {}; // nº do embarque → { chegou: bool, pendentes: [{item, peso, data}] }
  vals.forEach(function (row) {
    var numEmb = _normNumero(row[iEmbarque]);
    var item = row[iItem];
    if (!numEmb || item === '' || item == null) return;
    if (!grupos[numEmb]) grupos[numEmb] = { chegou: false, pendentes: [] };
    if (_norm(row[iSituacao]).indexOf('chegou') !== -1) {
      grupos[numEmb].chegou = true;
    } else {
      grupos[numEmb].pendentes.push({
        item: String(item).trim(),
        peso: parseFloat(row[iPeso]) || 0,
        data: row[iData] || ''
      });
    }
  });

  var linhas = [];
  Object.keys(grupos).forEach(function (numEmb) {
    var g = grupos[numEmb];
    if (!g.chegou || !g.pendentes.length) return; // só é pendência quando o embarque está parcial
    g.pendentes.forEach(function (p) {
      linhas.push([
        p.item, numEmb, p.peso, p.data,
        'Embarque ' + numEmb + ' já tem item(ns) lançado(s) no estoque, mas este ainda não foi encontrado.'
      ]);
    });
  });

  reescreverAba(CONFIG.SHEETS.PENDENCIAS_EMBARQUE, PENDENCIAS_EMBARQUE_HEADERS, linhas);
  return {
    pendentes: linhas.length,
    linhas: linhas.map(function (l) {
      return { item: l[0], embarque: l[1], quantidade: l[2], dataEmbarque: _soData(l[3]) };
    })
  };
}

/** Lista a aba PENDÊNCIAS EMBARQUE (para exibir a qualquer momento, sem rodar a análise). */
function listarPendenciasEmbarque(token) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER]);
  var regs = lerRegistros(CONFIG.SHEETS.PENDENCIAS_EMBARQUE);
  var linhas = regs.map(function (r) {
    return {
      item: r.ITEM,
      embarque: r.EMBARQUE,
      quantidade: r.QUANTIDADE,
      dataEmbarque: _soData(r.DATA_EMBARQUE),
      observacao: r.OBSERVACAO
    };
  });
  return { ok: true, linhas: linhas };
}
