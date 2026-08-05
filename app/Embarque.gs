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
 * uma busca global pelo padrão "TIPO [cor] CÓDIGO - caixas cx - peso", em vez
 * de depender de onde estão as quebras de linha. A palavra "cor" é OPCIONAL:
 * a maioria das linhas é "Fio X cor 6001 ...", mas algumas (ex.: "Fio
 * Reciclado Reflexx 4662 ...") põem o código logo após o tipo, sem "cor".
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

  // "cor" é OPCIONAL (ver docstring): algumas linhas trazem o código logo
  // depois do tipo, sem "cor". O código é sempre numérico ((\d+)) — isso
  // separa direito onde o tipo (com letras/dígitos) termina e o código começa
  // mesmo sem a palavra "cor" no meio.
  var RE = /([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9\/ ]{0,28}?)\s*(?:\bcor\s+)?(\d+)\s*[-–—_.]*\s*(\d+)\s*cx\s*[-–—_.]*\s*([\d.,]+)/gi;
  var out = [], m, faixas = [];
  while ((m = RE.exec(corpo)) !== null) {
    faixas.push([m.index, RE.lastIndex]);
    var peso = parseFloat(String(m[4]).replace(',', '.'));
    if (isNaN(peso)) peso = null;
    var tipo = m[1].trim();
    out.push({
      pos: m.index,
      descricao: (tipo + ' cor ' + m[2]).replace(/\s+/g, ' '),
      tipo: tipo,
      codigo: m[2],
      caixas: parseInt(m[3], 10),
      peso: peso,
      quantidade: peso != null ? Math.floor(peso) : null,
      naoInterpretado: false
    });
  }

  // REDE DE SEGURANÇA: nenhuma linha some. Todo trecho "<n>cx ... <peso>" que o
  // parser estrito NÃO capturou (um tipo/código fora do padrão conhecido) ainda
  // vira uma linha, marcada como "não interpretado". A quantidade já sai
  // preenchida (do peso); falta só o item, que o usuário informa na conferência
  // e o sistema aprende (vira regra pra próxima vez). Em relatório bem formado
  // isto não gera nada — tudo já foi pego acima.
  var CX = /(\d+)\s*cx\s*[-–—_.]*\s*([\d.,]+)/gi, c, ultimoFim = 0;
  while ((c = CX.exec(corpo)) !== null) {
    var ini = c.index, fim = CX.lastIndex;
    var coberto = faixas.some(function (f) { return ini < f[1] && fim > f[0]; });
    if (!coberto) {
      var antes = ultimoFim;
      faixas.forEach(function (f) { if (f[1] <= ini && f[1] > antes) antes = f[1]; });
      var trecho = corpo.slice(antes, fim)
        .replace(/.*R\$\s*[\d.,]+\s*/i, '')   // remove resíduo de linha "Total ... R$ x"
        .replace(/^[\s>._\-–—]+/, '').trim();
      var peso2 = parseFloat(String(c[2]).replace(',', '.'));
      if (isNaN(peso2)) peso2 = null;
      if (trecho && !/^total\b/i.test(trecho)) {
        out.push({
          pos: ini, descricao: trecho, tipo: '', codigo: '',
          caixas: parseInt(c[1], 10), peso: peso2,
          quantidade: peso2 != null ? Math.floor(peso2) : null,
          naoInterpretado: true
        });
      }
    }
    ultimoFim = fim;
  }

  out.sort(function (a, b) { return a.pos - b.pos; });   // mantém a ordem do relatório
  out.forEach(function (o) { delete o.pos; });
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
    if (it instanceof Date) return; // código lido como data (Sheets converteu ex.: "5711/1") — inválido, ignora
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
    if (!d) return;
    // Entrada corrompida: o Sheets converteu um código tipo "5711/1" em data
    // ao gravar. Ignora (não usa como aprendida) pra o item ser reconhecido de
    // novo pelas regras/estoque e reaprendido já como texto (ver `_salvarMapaEmbarque`).
    if (r[1] instanceof Date) return;
    if (r[1] !== '' && r[1] != null) mapa[d] = String(r[1]).trim();
  });
  return mapa;
}

/**
 * Salva o aprendizado (descrição do PDF → item), sem duplicar:
 *   - descrição nova            → acrescenta;
 *   - já aprendida, item DIFERENTE → CORRIGE a linha existente (o usuário pode
 *     ter ensinado errado na primeira vez e trocado o item na conferência —
 *     senão o erro se repetiria em toda importação futura);
 *   - já aprendida com o mesmo item → não faz nada.
 * @return {Object} { novos, corrigidos }
 */
function _salvarMapaEmbarque(pares) {
  var sh = _aba(CONFIG.SHEETS.MAPA_EMBARQUE, ['DESCRICAO', 'ITEM']);
  var porChave = {};
  lerRegistros(CONFIG.SHEETS.MAPA_EMBARQUE).forEach(function (r) {
    var k = _norm(r.DESCRICAO);
    if (k && !porChave[k]) porChave[k] = r;
  });

  var novos = [], corrigidos = 0, vistos = {};
  (pares || []).forEach(function (p) {
    if (!p.descricao || !p.item) return;
    var k = _norm(p.descricao);
    if (!k || vistos[k]) return; // mesma descrição repetida no mesmo PDF
    vistos[k] = true;
    var item = String(p.item).trim();
    var ex = porChave[k];
    if (!ex) {
      novos.push([String(p.descricao).trim(), item]);
      return;
    }
    // Item lido como data (célula corrompida) conta como "diferente", pra ser
    // regravado como texto — ver `_lerMapaEmbarque`.
    var atual = (ex.ITEM instanceof Date) ? '' : String(ex.ITEM == null ? '' : ex.ITEM).trim();
    if (_norm(atual) !== _norm(item)) {
      var cel = sh.getRange(ex.__row, 2);
      cel.setNumberFormat('@'); // TEXTO PURO (ver abaixo)
      cel.setValue(item);
      corrigidos++;
    }
  });

  if (novos.length) {
    var rng = sh.getRange(sh.getLastRow() + 1, 1, novos.length, 2);
    // TEXTO PURO: senão o Sheets converte códigos como "5711/1" (sufixo do
    // Reflexx) em data — foi a causa de item sair como "Thu Jan 01 5711...".
    rng.setNumberFormat('@');
    rng.setValues(novos);
  }
  return { novos: novos.length, corrigidos: corrigidos };
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
    } else if (l.naoInterpretado) {
      // Linha da rede de segurança (ver `_parseEmbarque`): não bateu com o
      // padrão nem com nada aprendido. Fica listada pro usuário informar o
      // item — ao gravar, vira regra aprendida pra próxima vez.
      motivo = 'não interpretei — informe o item';
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

var EMBARQUES_HEADERS = ['CORES', 'PESO', 'EMBARQUE', 'DATA', 'SITUAÇÃO', 'VOLUMES', 'SOLICITADO_EM'];

/**
 * Garante que a aba EMBARQUES tem todas as colunas do cabeçalho atual —
 * acrescenta no fim as que faltarem (ex.: VOLUMES), sem apagar nada. Mesmo
 * padrão de `_prepararFioCruEntradas`.
 */
function _prepararEmbarques() {
  var sh = _aba(CONFIG.SHEETS.EMBARQUES, EMBARQUES_HEADERS);
  var largura = sh.getLastColumn();
  var atuais = largura ? sh.getRange(1, 1, 1, largura).getValues()[0].map(function (h) { return String(h).trim(); }) : [];
  EMBARQUES_HEADERS.forEach(function (h) {
    if (atuais.indexOf(h) === -1) {
      atuais.push(h);
      sh.getRange(1, atuais.length).setValue(h)
        .setFontWeight('bold').setBackground('#0F5FA0').setFontColor('#FFFFFF');
    }
  });
  return sh;
}

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
function _registrarEmbarqueEDarBaixa(itens, doc, data, usuario, lotesCru) {
  var sh = _prepararEmbarques();
  // Data de solicitação (GERADO_EM) vem da lista pendente — igual ao VOLUMES,
  // fica registrada no embarque pra não se perder quando o item sair da
  // pendência (a baixa acontece logo abaixo, depois de gravar aqui). Sem
  // isso, o Relatório perdia essa data assim que o item era embarcado.
  var dataSolicitadoPorItem = {};
  lerRegistros(CONFIG.SHEETS.PENDENCIA_COMPRA).forEach(function (r) {
    var k = _norm(r.ITEM);
    if (k && dataSolicitadoPorItem[k] == null) dataSolicitadoPorItem[k] = r.GERADO_EM;
  });
  var linhas = itens.map(function (it) {
    // VOLUMES vem da lista pendente (informado no tingimento e corrigível na
    // confirmação) — fica registrado no embarque pra não se perder quando o
    // item sair da pendência.
    var vol = (it.volumes === '' || it.volumes == null) ? '' : (Number(it.volumes) || 0);
    var solicitadoEm = dataSolicitadoPorItem[_norm(it.item)];
    return [String(it.item).trim(), Number(it.quantidade) || 0, doc, data, '', vol,
      solicitadoEm == null ? '' : solicitadoEm];
  });
  var inicio = sh.getLastRow() + 1;
  // Coluna CORES (item) como TEXTO PURO: senão o Sheets converte códigos como
  // "5711/1" em data, e a conciliação de chegada/"em viagem" (que casa item
  // por texto) deixa de bater. Só a coluna 1 — as outras seguem número/data.
  sh.getRange(inicio, 1, linhas.length, 1).setNumberFormat('@');
  sh.getRange(inicio, 1, linhas.length, EMBARQUES_HEADERS.length).setValues(linhas);
  var baixa = _baixarPendenciaCompraPorEmbarque(itens);
  // Instantâneo de estorno: guarda o consumo de crú (lotesCru) e as
  // quantidades tiradas da pendência, pra poder CANCELAR depois com precisão
  // (ver `cancelarEmbarque`). PDF não consome crú → lotesCru vazio.
  _registrarEstornoEmbarque(doc, usuario || '',
    itens.map(function (it) { return { item: String(it.item).trim(), quantidade: Number(it.quantidade) || 0 }; }),
    lotesCru || []);
  return { gravados: linhas.length, baixados: baixa.baixados };
}

var EMBARQUE_ESTORNO_HEADERS = ['EMBARQUE', 'DATA_HORA', 'USUARIO', 'SITUACAO', 'DADOS_JSON'];

/** Guarda o instantâneo de estorno de um embarque (ver `cancelarEmbarque`). */
function _registrarEstornoEmbarque(numero, usuario, itens, lotes) {
  var sh = _aba(CONFIG.SHEETS.EMBARQUE_ESTORNO, EMBARQUE_ESTORNO_HEADERS);
  var inicio = sh.getLastRow() + 1;
  sh.getRange(inicio, 1, 1, 1).setNumberFormat('@'); // nº como texto
  sh.getRange(inicio, 1, 1, EMBARQUE_ESTORNO_HEADERS.length)
    .setValues([[String(numero), new Date(), usuario || '', '', JSON.stringify({ itens: itens || [], lotes: lotes || [] })]]);
}

/**
 * Grava o embarque conferido (lido de PDF) na aba EMBARQUES, memoriza as
 * descrições novas e dá baixa automática na lista pendente — ver
 * `_registrarEmbarqueEDarBaixa`.
 * @param {Object} dados { doc, data:'dd/MM/aaaa', itens:[{descricao,item,quantidade}] }
 */
function gravarEmbarque(token, dados) {
  var s = exigirSessao(token, [CONFIG.PAPEIS.MASTER, CONFIG.PAPEIS.ALMOX1]);
  dados = dados || {};
  var doc = parseInt(dados.doc, 10);
  if (!doc) throw new Error('Informe o número do embarque.');
  var data = _parseDataBR(dados.data);
  if (!data) throw new Error('Data do embarque inválida (use dd/mm/aaaa).');

  var itens = (dados.itens || []).filter(function (it) { return it.item && String(it.item).trim(); });
  if (!itens.length) throw new Error('Nenhum item válido para gravar. Resolva os itens pendentes.');

  // Aprende as descrições resolvidas (para reconhecer nas próximas vezes) e
  // CORRIGE as que já estavam aprendidas com outro item (ensino errado antes).
  var aprendizado = _salvarMapaEmbarque(itens.map(function (it) {
    return { descricao: it.descricao, item: it.item };
  }));

  // Leva os VOLUMES da lista pendente (informados no tingimento) pro registro
  // do embarque — o PDF da transportadora não traz esse dado.
  var volumesPorItem = {};
  lerRegistros(CONFIG.SHEETS.PENDENCIA_COMPRA).forEach(function (r) {
    var k = _norm(r.ITEM);
    if (k && volumesPorItem[k] == null && r.VOLUMES !== '' && r.VOLUMES != null) {
      volumesPorItem[k] = Number(r.VOLUMES) || 0;
    }
  });
  itens.forEach(function (it) {
    if (it.volumes === '' || it.volumes == null) {
      var v = volumesPorItem[_norm(it.item)];
      if (v != null) it.volumes = v;
    }
  });

  var r = _registrarEmbarqueEDarBaixa(itens, doc, data, s.usuario);
  return {
    ok: true, gravados: r.gravados, baixados: r.baixados,
    aprendidos: aprendizado.novos, corrigidos: aprendizado.corrigidos
  };
}

/**
 * Número do PRÓXIMO embarque lançado manualmente (sem PDF) — sequência
 * própria por unidade, pra não colidir com o número real de relatório de
 * transportadora usado no fluxo por PDF. Sem a Propriedade do script ainda
 * definida, cada unidade começa no ponto pedido (mesma ideia do número do
 * Pedido de Fio — ver `NUMERO_PEDIDO_INICIAL_POR_UNIDADE`); a partir da
 * primeira confirmação (ou de um ajuste manual, ver `definirProximoNumeroEmbarque`)
 * quem manda é a Propriedade.
 */
var NUMERO_EMBARQUE_INICIAL_POR_UNIDADE = {
  CEARA: 985,
  BAHIA: 1472
};
var NUMERO_EMBARQUE_INICIAL_PADRAO = 1;

function _numeroEmbarqueManualAtual() {
  var unidade = _unidadeAtivaId || CONFIG.UNIDADE_PADRAO;
  var v = PropertiesService.getScriptProperties().getProperty(_propUnidade('NUMERO_EMBARQUE_MANUAL'));
  var n = parseInt(v, 10);
  if (v && !isNaN(n)) return n;
  return NUMERO_EMBARQUE_INICIAL_POR_UNIDADE.hasOwnProperty(unidade)
    ? NUMERO_EMBARQUE_INICIAL_POR_UNIDADE[unidade]
    : NUMERO_EMBARQUE_INICIAL_PADRAO;
}
function _avancarNumeroEmbarqueManual() {
  PropertiesService.getScriptProperties()
    .setProperty(_propUnidade('NUMERO_EMBARQUE_MANUAL'), String(_numeroEmbarqueManualAtual() + 1));
}

/** Próximo número de embarque desta unidade, pra mostrar na tela Confirmar Embarque. */
function obterProximoNumeroEmbarque(token) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER, CONFIG.PAPEIS.ALMOX1]);
  return { ok: true, numero: _numeroEmbarqueManualAtual() };
}

/**
 * Ajusta na mão o próximo número de embarque desta unidade (não mexe nos já
 * confirmados) — usado quando a numeração do sistema precisa alinhar com a
 * sequência real (ex.: reiniciar/pular pra um número específico).
 */
function definirProximoNumeroEmbarque(token, numero) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER, CONFIG.PAPEIS.ALMOX1]);
  var n = parseInt(numero, 10);
  if (!n || n < 1) throw new Error('Informe um número de embarque válido (maior que zero).');
  PropertiesService.getScriptProperties().setProperty(_propUnidade('NUMERO_EMBARQUE_MANUAL'), String(n));
  return { ok: true, numero: n };
}

/**
 * Última taxa de mão de obra (R$/kg) usada nesta unidade — memorizada a cada
 * confirmação de embarque E a cada edição do campo na tela (ver
 * `salvarCustoMaoObra`), pra pré-preencher a tela Confirmar Embarque na
 * próxima vez, mesmo que a confirmação anterior não tenha chegado a acontecer
 * (ex.: barrada pela checagem de duplicidade). Guardada por unidade (ver
 * `_propUnidade`), como os e-mails e a numeração. Devolve null se nunca foi
 * definida.
 */
function _custoMaoObraSalvo() {
  var v = PropertiesService.getScriptProperties().getProperty(_propUnidade('CUSTO_MAO_OBRA'));
  var n = parseFloat(v);
  return (v != null && v !== '' && !isNaN(n)) ? n : null;
}
function _definirCustoMaoObra(n) {
  PropertiesService.getScriptProperties()
    .setProperty(_propUnidade('CUSTO_MAO_OBRA'), String(Number(n) || 0));
}

/** Taxa de mão de obra (R$/kg) memorizada, pra pré-preencher a tela Confirmar Embarque. */
function obterCustoMaoObra(token) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER, CONFIG.PAPEIS.ALMOX1]);
  return { ok: true, custoMaoObra: _custoMaoObraSalvo() };
}

/** Salva a taxa de mão de obra assim que o usuário edita o campo na tela —
 * não espera uma confirmação de embarque acontecer (ver docstring acima). */
function salvarCustoMaoObra(token, valor) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER, CONFIG.PAPEIS.ALMOX1]);
  var n = parseFloat(String(valor == null ? '' : valor).replace(',', '.'));
  if (isNaN(n) || n < 0) n = 0;
  _definirCustoMaoObra(n);
  return { ok: true, custoMaoObra: n };
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
 * Ao final, dispara um e-mail com o relatório em ANEXO (PDF) — o corpo do
 * e-mail só avisa o que está sendo enviado. O relatório é separado por tipo
 * de fio (um bloco por tipo): os itens tingidos daquele tipo com o custo de
 * mão de obra de cada um, e logo abaixo o consumo no estoque de fio crú —
 * item, NF, fornecedor, data da NF, peso REALMENTE consumido dela (pode ser
 * negativo, se for um crédito de volta) e o saldo que ficou depois. Cada
 * bloco mostra o total de mão de obra do tipo de fio, e no fim vem o total
 * geral.
 *
 * O custo de mão de obra é uma taxa ÚNICA em R$ por kg tingido (params.
 * custoMaoObra), aplicada a todos os itens: o valor de cada item é
 * quantidade confirmada × taxa.
 *
 * "DO ESTOQUE" (it.doEstoque): quando marcado na tela, a parte da quantidade
 * confirmada que PASSAR do que já foi tingido sai do estoque de produto
 * PRONTO do usuário — NÃO consome fio crú. Ex.: tingiu 50, confirma 100 com
 * a caixa marcada → 50 continuam vindos do crú (o que já estava baixado) e
 * 50 são do estoque, sem baixa extra. Tingiu 0 + marcado → nada sai do crú.
 * A mão de obra também só conta os kg que passaram pelo tingimento (a parte
 * do estoque já estava pronta — não teve tingimento agora). Se o valor
 * confirmado for MENOR ou igual ao já tingido, a marcação não muda nada
 * (segue o ajuste normal, inclusive crédito de volta).
 *
 * MALOTE (params.malote): quando o embarque leva um malote junto, o relatório
 * avisa. Dois casos, escolhidos na tela:
 *   - `modo: 'fios'`   → o malote segue COM os fios, na mesma nota: o PDF só
 *                        informa que existe; nada muda nos números.
 *   - `modo: 'volumes'`→ o malote vai em NOTA SEPARADA: o PDF ganha um campo
 *                        próprio com a quantidade de volumes do malote, pro
 *                        usuário emitir a nota só dele. Esses volumes NÃO
 *                        entram no total de volumes dos fios.
 *
 * Por ora, só o master e o almoxarifado 1 usam esta tela — ver `exigirSessao`.
 * @param {Object} params { itens: [{item, quantidade, doEstoque}], custoMaoObra,
 *                          observacao, malote: {ativo, modo, volumes} }
 * @return {Object} { ok, numero, gravados, baixados, resumo, custoMaoObra }
 */
function confirmarEmbarqueManual(token, params) {
  var s = exigirSessao(token, [CONFIG.PAPEIS.MASTER, CONFIG.PAPEIS.ALMOX1]);
  params = params || {};
  var itens = (params.itens || [])
    .filter(function (it) { return it.item && Number(it.quantidade) > 0; })
    .map(function (it) {
      return {
        item: String(it.item).trim(), quantidade: Number(it.quantidade),
        doEstoque: !!it.doEstoque, obs: String(it.obs == null ? '' : it.obs).trim(),
        volumes: (it.volumes === '' || it.volumes == null) ? '' : (Number(it.volumes) || 0)
      };
    });
  if (!itens.length) throw new Error('Marque ao menos um item, com quantidade, para confirmar o embarque.');
  // Observação geral, digitada na tela — sai no FIM do relatório (PDF).
  var observacao = String(params.observacao == null ? '' : params.observacao).trim();

  // Taxa de mão de obra (R$ por kg tingido), única para todo o embarque.
  // Aceita vírgula ou ponto como separador decimal; nunca negativa; vazio = 0.
  var custoMaoObra = parseFloat(String(params.custoMaoObra == null ? '' : params.custoMaoObra).replace(',', '.'));
  if (isNaN(custoMaoObra) || custoMaoObra < 0) custoMaoObra = 0;

  var malote = _normalizarMalote(params.malote);

  var lista = _destinatariosCompra().split(/[;,]/)
    .map(function (e) { return e.trim(); })
    .filter(function (e) { return e && e.indexOf('@') !== -1; });
  if (!lista.length) {
    throw new Error('Informe pelo menos um e-mail de destino (mesma lista da tela de Tingimento) antes de confirmar.');
  }

  // Trava contra CLIQUE DUPLO / reenvio (ver `_travaEmbarque` e
  // `_conferirEmbarqueDuplicado`): duas confirmações do mesmo embarque geram
  // dois números, cobram a mão de obra duas vezes, contam o mesmo item duas
  // vezes como "em viagem" e mandam dois e-mails. Aconteceu de verdade
  // (embarques nº 3 e nº 4 da Bahia).
  var trava = _travaEmbarque();
  try {
    _conferirEmbarqueDuplicado(itens, !!params.confirmarDuplicado);
    return _confirmarEmbarqueManualInterno(s, itens, observacao, custoMaoObra, malote, lista);
  } finally {
    try { trava.releaseLock(); } catch (e) {}
  }
}

/**
 * Trava de execução da confirmação de embarque. Segura o segundo clique até o
 * primeiro terminar — sem isso, dois cliques quase simultâneos passariam os
 * dois pela checagem de duplicado (que ainda não teria o que comparar).
 */
function _travaEmbarque() {
  var lock = LockService.getScriptLock();
  var pegou = false;
  try { pegou = lock.tryLock(60000); } catch (e) { pegou = false; }
  if (!pegou) {
    throw new Error('Já existe uma confirmação de embarque em andamento (pode ser um clique duplo). ' +
      'Espere ela terminar e confira o histórico antes de tentar de novo.');
  }
  return lock;
}

/** Impressão digital do conjunto confirmado: item + quantidade, em ordem. */
function _assinaturaEmbarque(itens) {
  return itens.map(function (it) { return _norm(it.item) + '=' + (Number(it.quantidade) || 0); })
    .sort().join(';');
}

/** Janela em que uma confirmação idêntica é tratada como clique duplo. */
var EMBARQUE_JANELA_DUPLICADO_MIN = 30;

/**
 * Recusa a confirmação quando ela é, quase com certeza, um REENVIO do mesmo
 * embarque. Dois sinais, cada um suficiente:
 *
 *  1. Mesmíssimo conjunto (itens + quantidades) confirmado há menos de
 *     `EMBARQUE_JANELA_DUPLICADO_MIN` minutos nesta unidade.
 *  2. NENHUM dos itens está mais na lista pendente (PENDENCIA_COMPRA) — a tela
 *     só oferece itens que estão lá, então isso significa que eles já foram
 *     baixados por uma confirmação anterior.
 *
 * `forcar` (a opção "confirmar mesmo assim" da tela) passa por cima dos dois —
 * existe caso legítimo de repetir os mesmos itens (segunda remessa igual).
 */
function _conferirEmbarqueDuplicado(itens, forcar) {
  if (forcar) return;

  var registro = _ultimoEmbarqueConfirmado();
  if (registro && registro.assinatura === _assinaturaEmbarque(itens)) {
    var minutos = Math.max(0, Math.round((new Date().getTime() - (registro.quando || 0)) / 60000));
    if (minutos <= EMBARQUE_JANELA_DUPLICADO_MIN) {
      throw new Error('DUPLICADO: este mesmo embarque (' + itens.length + ' item(ns), mesmas quantidades) ' +
        'já foi confirmado há ' + minutos + ' minuto(s) — nº ' + registro.numero +
        (registro.usuario ? ', por ' + registro.usuario : '') + '. O e-mail já foi enviado. ' +
        'Se for mesmo um embarque NOVO com os mesmos itens, use "Confirmar mesmo assim".');
    }
  }

  var pendentes = {};
  lerRegistros(CONFIG.SHEETS.PENDENCIA_COMPRA).filter(_emAberto).forEach(function (r) {
    var k = _norm(_itemDeCelula(r.ITEM));
    if (k) pendentes[k] = true;
  });
  var algumPendente = itens.some(function (it) { return pendentes[_norm(it.item)]; });
  if (!algumPendente) {
    throw new Error('DUPLICADO: nenhum destes itens está na lista pendente — eles já saíram dela, ' +
      'o que normalmente quer dizer que este embarque já foi confirmado. Confira o histórico de ' +
      'embarques confirmados. Se estiver certo, use "Confirmar mesmo assim".');
  }
}

/** Última confirmação de embarque desta unidade (para detectar clique duplo). */
function _ultimoEmbarqueConfirmado() {
  var bruto = PropertiesService.getScriptProperties().getProperty(_propUnidade('ULTIMO_EMBARQUE_CONFIRMADO'));
  if (!bruto) return null;
  try { return JSON.parse(bruto); } catch (e) { return null; }
}

/** Registra a confirmação recém-feita (assinatura, número, quem e quando). */
function _registrarUltimoEmbarqueConfirmado(itens, numero, usuario) {
  try {
    PropertiesService.getScriptProperties().setProperty(
      _propUnidade('ULTIMO_EMBARQUE_CONFIRMADO'),
      JSON.stringify({
        assinatura: _assinaturaEmbarque(itens), numero: numero,
        usuario: usuario || '', quando: new Date().getTime()
      }));
  } catch (e) { /* registro é proteção extra; não pode derrubar a confirmação */ }
}

/** Miolo da confirmação (já validada contra duplicidade — ver `confirmarEmbarqueManual`). */
function _confirmarEmbarqueManualInterno(s, itens, observacao, custoMaoObra, malote, lista) {
  var tipoFioPorItem = {};
  lerRegistros(CONFIG.SHEETS.PENDENCIA_COMPRA).forEach(function (r) {
    var k = _norm(r.ITEM);
    if (k && !tipoFioPorItem[k]) tipoFioPorItem[k] = String(r.TIPO_FIO || '').trim();
  });

  // Confirma (ou corrige) a baixa do fio crú de cada item pro valor que está
  // sendo confirmado agora, ANTES de gravar o embarque. `ajuste.lotes` traz o
  // PESO real tirado (ou creditado de volta, se negativo) de cada NF NESTA
  // confirmação — é isso que vai no relatório, não um resumo histórico do item.
  // Itens marcados "do estoque" com quantidade acima do já tingido NÃO passam
  // pelo ajuste: a sobra sai do estoque de produto pronto (ver docstring).
  var tingidoAtualPorItem = _tingidoPorItem();
  var porTipo = {}; // tipoFio -> { tipoFio, totalTingido, totalEstoque, itens:[...], lotes:[...] }
  var deltaLotes = []; // só o que ESTA confirmação baixou/creditou (pro estorno)
  var itensPorTipo = {}; // chaveTipo -> [itens] (pra montar o consumo depois)
  itens.forEach(function (it) {
    // Sempre a classificação ATUAL da BASE TINGIMENTO (ver `_tipoFioAtualDoItem`)
    // — nunca o TIPO_FIO gravado em PENDENCIA_COMPRA na hora da análise, que é
    // um instantâneo e fica desatualizado se a BASE TINGIMENTO ganhar depois
    // um padrão novo/mais específico (foi assim que um item "…/1 RECICLADO"
    // saiu como "Fio Reflex 2x167/48" em vez de "…Reciclado…" na confirmação,
    // mesmo já existindo o padrão certo na BASE TINGIMENTO). Só cai no valor
    // gravado quando o item não bate com nada hoje — inclui o caso de item que
    // já saiu da lista pendente (confirmação forçada de embarque repetido),
    // que antes saía inteiro sob "(tipo de fio não identificado)".
    var tipoFio = _tipoFioAtualDoItem(it.item, tipoFioPorItem[_norm(it.item)]);
    var chaveTipo = tipoFio || '(tipo de fio não identificado)';
    // `it.quantidade` vem da tela já descontado do TINGIDO_BASELINE do item
    // (ver `obterListaFioParaTingir`, em FioCru.gs) — se este item é o saldo
    // residual de um embarque parcial anterior, tanto o "já tingido" quanto a
    // quantidade confirmada aqui só contam o que é NOVO pra este saldo, não o
    // histórico completo do item. `jaTingido` abaixo segue a mesma régua, pra
    // comparar maçã com maçã; `_ajustarBaixaFioCru`, porém, trabalha com o
    // total histórico ABSOLUTO — por isso somamos o baseline de volta só na
    // hora de chamá-lo.
    var baseline = _baselineTingidoDoItemPendente(it.item);
    var jaTingido = Math.max(0, (tingidoAtualPorItem[_norm(it.item)] || 0) - baseline);
    // Só é "do estoque" de verdade se confirmar MAIS do que o já tingido —
    // senão não há sobra nenhuma pra tirar do estoque pronto.
    var qtdEstoque = (it.doEstoque && it.quantidade > jaTingido) ? (it.quantidade - jaTingido) : 0;
    if (qtdEstoque > 0) {
      // Não mexe no fio crú: o que já estava baixado (jaTingido) permanece
      // como o consumo do crú; a sobra é estoque pronto. Nenhuma linha nova
      // no razão de baixas.
    } else {
      var ajuste = _ajustarBaixaFioCru(tipoFio, it.item, baseline + it.quantidade, s.usuario);
      (ajuste.lotes || []).forEach(function (l) {
        deltaLotes.push({
          // tipo de fio REAL da linha de baixa (pode diferir do tipo do item por
          // caso especial) — é o que o estorno precisa pra creditar na NF certa.
          tipoFio: l.tipoFio || tipoFio, item: it.item, nf: l.nf,
          dataNf: l.dataNf, peso: l.quantidadeBaixada
        });
      });
    }
    if (!porTipo[chaveTipo]) porTipo[chaveTipo] = { tipoFio: chaveTipo, totalTingido: 0, totalEstoque: 0, itens: [], lotes: [] };
    porTipo[chaveTipo].totalTingido += it.quantidade - qtdEstoque;
    porTipo[chaveTipo].totalEstoque += qtdEstoque;
    porTipo[chaveTipo].itens.push({
      item: it.item, quantidade: it.quantidade, qtdEstoque: qtdEstoque, obs: it.obs, volumes: it.volumes
    });
    if (!itensPorTipo[chaveTipo]) itensPorTipo[chaveTipo] = [];
    itensPorTipo[chaveTipo].push(it.item);
  });

  // NFs consumidas pra o relatório: vêm do RAZÃO (depois dos ajustes acima),
  // não da diferença desta confirmação — no caminho normal o consumo aconteceu
  // ao lançar o tingimento, e a diferença aqui é zero (ver `_consumoCruPorItens`).
  var consumoPorItem = _consumoCruPorItens(itens.map(function (it) { return it.item; }));
  Object.keys(itensPorTipo).forEach(function (chaveTipo) {
    itensPorTipo[chaveTipo].forEach(function (item) {
      (consumoPorItem[_norm(item)] || []).forEach(function (c) {
        porTipo[chaveTipo].lotes.push({
          item: item, nf: c.nf, fornecedor: c.fornecedor || '',
          dataNf: c.dataNf, peso: c.peso, saldoApos: c.saldoApos,
          // Preço unitário e quantidade original da NF de onde o fio saiu
          // (pedido dos usuários).
          precoUnitario: c.precoUnitario, quantidadeNf: c.quantidadeNf
        });
      });
    });
  });
  var resumo = Object.keys(porTipo).map(function (t) {
    var g = porTipo[t];
    return {
      tipoFio: g.tipoFio, totalTingido: g.totalTingido, totalEstoque: g.totalEstoque,
      // Mão de obra só sobre o que passou pelo tingimento — a parte "do
      // estoque" já estava pronta, não teve tingimento nesta confirmação.
      maoObra: g.totalTingido * custoMaoObra, itens: g.itens, lotes: g.lotes
    };
  });

  // Instantâneo de estorno leva SÓ o delta desta confirmação — cancelar não
  // pode creditar de volta o consumo que veio do lançamento do tingimento.
  var numero = _numeroEmbarqueManualAtual();
  var agora = new Date();
  var r = _registrarEmbarqueEDarBaixa(itens, numero, agora, s.usuario, deltaLotes);
  _avancarNumeroEmbarqueManual(); // só agora — o registro já foi gravado
  // Registra ANTES do e-mail: se o envio falhar e o usuário tentar de novo, o
  // embarque já está gravado — a segunda tentativa tem que ser barrada como
  // duplicada (ver `_conferirEmbarqueDuplicado`).
  _registrarUltimoEmbarqueConfirmado(itens, numero, s.usuario);

  var unidade = CONFIG.getUnidadeInfo(s.unidade).rotulo.toUpperCase();
  var dataFmt = Utilities.formatDate(agora, Session.getScriptTimeZone(), 'dd/MM/yyyy');
  var html = _confirmacaoEmbarqueHTML(numero, dataFmt, resumo, custoMaoObra, unidade, observacao, malote);
  var pdf = Utilities.newBlob(html, MimeType.HTML, 'confirmacao.html').getAs(MimeType.PDF)
    .setName('Confirmacao de Embarque Marfim ' + _semAcento(unidade) + ' no ' + numero + '.pdf');
  MailApp.sendEmail({
    to: lista.join(','),
    subject: 'Confirmação de Embarque ' + unidade + ' nº ' + numero + ' - ' + dataFmt,
    htmlBody: '<p style="font-family:Arial,Helvetica,sans-serif;color:#1c2733">Segue em anexo a Confirmação ' +
      'de Embarque ' + unidade + ' nº <b>' + numero + '</b>, de <b>' + dataFmt + '</b> — com os itens ' +
      'embarcados, o total de volumes, o consumo no estoque de fio crú (por tipo de fio, com NF e ' +
      'fornecedor) e o custo de mão de obra.' + _avisoMaloteEmail(malote) + '</p>',
    attachments: [pdf]
  });
  // Memoriza a taxa usada agora, pra pré-preencher a próxima confirmação
  // desta unidade (o e-mail já saiu — isto é só registro).
  _definirCustoMaoObra(custoMaoObra);

  return {
    ok: true, numero: numero, gravados: r.gravados, baixados: r.baixados,
    resumo: resumo, custoMaoObra: custoMaoObra, destinatarios: lista.length,
    volumesTotal: _totalVolumesResumo(resumo), malote: malote
  };
}

/**
 * Normaliza o malote informado na tela. `modo` só pode ser:
 *   'fios'    — segue junto com os fios (mesma nota): o PDF só informa;
 *   'volumes' — nota separada só do malote: exige a quantidade de volumes.
 * Sem malote (ou marcado sem escolher nada), devolve { ativo: false }.
 */
function _normalizarMalote(m) {
  m = m || {};
  if (!m.ativo) return { ativo: false, modo: '', volumes: 0 };
  var modo = String(m.modo || '').trim().toLowerCase();
  if (modo !== 'volumes') return { ativo: true, modo: 'fios', volumes: 0 };
  var vol = parseFloat(String(m.volumes == null ? '' : m.volumes).replace(',', '.'));
  if (isNaN(vol) || vol <= 0) {
    throw new Error('Malote com nota separada: informe a quantidade de volumes do malote ' +
      '(ou marque "segue com os fios").');
  }
  return { ativo: true, modo: 'volumes', volumes: vol };
}

/** Soma dos volumes dos itens do embarque (não inclui o malote em nota separada). */
function _totalVolumesResumo(resumo) {
  return (resumo || []).reduce(function (acc, g) {
    return acc + (g.itens || []).reduce(function (a, it) { return a + (Number(it.volumes) || 0); }, 0);
  }, 0);
}

/** Frase curta sobre o malote pro corpo do e-mail (vazia quando não há malote). */
function _avisoMaloteEmail(malote) {
  if (!malote || !malote.ativo) return '';
  return malote.modo === 'volumes'
    ? ' <b>Atenção: este embarque leva MALOTE em nota separada — ' + _numeroBR(malote.volumes) +
      ' volume(s)</b> (ver o campo próprio no PDF).'
    : ' <b>Atenção: este embarque leva um MALOTE, seguindo junto com os fios.</b>';
}

/** Número no formato brasileiro, sem casas decimais desnecessárias (ex.: 3, 2,5). */
function _numeroBR(v) {
  var n = Number(v) || 0;
  var s = (Math.round(n * 100) / 100).toFixed(2).replace(/\.?0+$/, '');
  return s.replace('.', ',');
}

/** Escapa texto digitado pelo usuário pra entrar com segurança no HTML do e-mail. */
function _escHtmlEmail(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Formata um número como moeda em Reais (ex.: 1234.5 → "R$ 1.234,50"). */
function _moedaBR(v) {
  var n = Number(v) || 0;
  var neg = n < 0;
  n = Math.abs(n);
  var partes = n.toFixed(2).split('.');
  var inteiro = partes[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (neg ? '-' : '') + 'R$ ' + inteiro + ',' + partes[1];
}

/**
 * Monta o HTML do relatório de Confirmação de Embarque (usado como PDF em
 * anexo). Um bloco por tipo de fio: cabeçalho do tipo (com total tingido e o
 * total de mão de obra do grupo), a tabela de itens tingidos daquele tipo
 * (com o custo de mão de obra de cada item) e, abaixo, o consumo no estoque
 * de fio crú (item, NF, fornecedor, data da NF, quantidade ORIGINAL da nota,
 * PREÇO UNITÁRIO dela, peso consumido e SALDO restante — listando TODAS as
 * NFs usadas; preço e saldo saem em destaque, que é o que os usuários
 * procuram primeiro). No fim, o total geral de mão de obra do embarque.
 * Cada item mostra a mão de obra unitária (R$/kg) e o total do item; a
 * `observacao` geral (digitada na tela) sai no fim do relatório.
 *
 * Totais do rodapé: o TOTAL DE VOLUMES dos fios e o total de mão de obra —
 * este sempre acompanhado da BASE usada (R$/kg × kg tingidos), pra quem lê
 * saber de onde saiu o valor. O malote, quando existe, ganha um bloco
 * próprio (com os volumes dele, quando vai em nota separada).
 *
 * @param {number} custoMaoObra  taxa única em R$ por kg tingido.
 * @param {string} observacao    observação geral, opcional.
 * @param {Object} malote        { ativo, modo: 'fios'|'volumes', volumes }.
 */
function _confirmacaoEmbarqueHTML(numero, dataFmt, resumo, custoMaoObra, unidade, observacao, malote) {
  // Densidade conforme o tamanho total do relatório (itens + NFs + chrome de
  // cada bloco), pra tentar caber numa página A4 retrato (ver `_densidadeRelatorio`).
  var linhasEstimadas = resumo.reduce(function (a, g) {
    return a + g.itens.length + Math.max(g.lotes.length, 1) + 3;
  }, 0) + ((malote && malote.ativo) ? 3 : 0);
  var d = _densidadeRelatorio(linhasEstimadas);
  var thStyle = 'border:1px solid #cbd5e1;padding:' + d.pad + ';background:#0F5FA0;' +
    'color:#fff;text-align:left;font-size:' + d.fonte + 'px';
  var tdStyle = 'border:1px solid #cbd5e1;padding:' + d.pad + ';font-size:' + d.fonte + 'px';
  function th(t) { return '<th style="' + thStyle + '">' + t + '</th>'; }
  function td(v) { return '<td style="' + tdStyle + '">' + v + '</td>'; }

  // As duas colunas que os usuários leem primeiro (preço unitário da NF e
  // saldo restante) saem em DESTAQUE: cabeçalho e célula com fundo próprio,
  // negrito e um corpo maior que o resto da tabela.
  var thStyleDestaque = 'border:1px solid #0B4576;padding:' + d.pad + ';background:#0B4576;' +
    'color:#FFD98A;text-align:left;font-size:' + d.fonte + 'px;font-weight:bold';
  function thD(t) { return '<th style="' + thStyleDestaque + '">' + t + '</th>'; }
  function tdD(v, fundo, cor) {
    return '<td style="' + tdStyle + ';background:' + fundo + ';color:' + cor +
      ';font-weight:bold;font-size:' + (d.fonte + 1) + 'px;white-space:nowrap">' + v + '</td>';
  }

  var thItens = ['Item', 'Volumes', 'Quantidade (kg)', 'Mão de obra unitária (R$/kg)', 'Mão de obra total (R$)'].map(th).join('');
  // Consumo de fio crú: a NF de onde saiu a baixa, com a QUANTIDADE ORIGINAL
  // da nota, o PREÇO UNITÁRIO dela (a que preço aquele fio entrou), o quanto
  // foi consumido agora e o SALDO que ficou. Preço e saldo em destaque —
  // pedido dos usuários.
  var thLotes = th('Item') + th('NF') + th('Fornecedor') + th('Data da NF') +
    th('Qtd. da NF (kg)') + thD('Preço unit. (R$)') + th('Peso consumido (kg)') +
    thD('Saldo restante (kg)');
  var COLS_LOTES = 8;
  var rotuloFonte = Math.max(d.fonte - 1, 8);

  var totalGeral = 0;
  var totalVolumes = 0;
  var totalKgTingido = 0;
  var blocos = resumo.map(function (g) {
    totalGeral += g.maoObra || 0;
    totalKgTingido += Number(g.totalTingido) || 0;
    var volumesGrupo = (g.itens || []).reduce(function (a, it) { return a + (Number(it.volumes) || 0); }, 0);
    totalVolumes += volumesGrupo;

    var rowsItens = g.itens.map(function (it) {
      var qtdEstoque = Number(it.qtdEstoque) || 0;
      var qtdCel = qtdEstoque > 0
        ? it.quantidade + ' <span style="color:#64748b">(' + qtdEstoque + ' do estoque, sem consumo de crú)</span>'
        : String(it.quantidade);
      var volCel = (it.volumes === '' || it.volumes == null) ? '—' : String(it.volumes);
      // Mão de obra só sobre o que passou pelo tingimento.
      return '<tr>' + td(it.item) + td(volCel) + td(qtdCel) +
        td(_moedaBR(custoMaoObra) + '/kg') +
        td(_moedaBR((it.quantidade - qtdEstoque) * custoMaoObra)) + '</tr>';
    }).join('');

    var msgSemLotes = (Number(g.totalEstoque) > 0 && !g.totalTingido)
      ? 'saída do estoque de produto pronto — sem consumo de fio crú nesta confirmação'
      : 'sem NF de fio crú associada (lance a quantidade tingida antes de confirmar o embarque)';
    var rowsLotes = g.lotes.length
      ? g.lotes.map(function (l) {
          // NF sem preço cadastrado sai como "—" (não inventa zero).
          var precoCel = (l.precoUnitario === '' || l.precoUnitario == null)
            ? '—' : _moedaBR(l.precoUnitario);
          var qtdNfCel = (l.quantidadeNf === '' || l.quantidadeNf == null)
            ? '—' : _numeroBR(l.quantidadeNf);
          // Saldo zerado ou negativo vai em vermelho: a NF acabou (ou passou).
          var saldoNum = Number(l.saldoApos);
          var saldoCel = (l.saldoApos === '' || l.saldoApos == null || isNaN(saldoNum))
            ? '—' : _numeroBR(saldoNum);
          var saldoVazio = !isNaN(saldoNum) && saldoNum <= 0;
          return '<tr>' + td(l.item) + td(l.nf || '—') + td(l.fornecedor || '—') +
            td(l.dataNf || '—') + td(qtdNfCel) +
            tdD(precoCel, '#EAF2FB', '#0B4576') + td(l.peso) +
            tdD(saldoCel, saldoVazio ? '#FDECEA' : '#FFF7E0', saldoVazio ? '#B91C1C' : '#7A5B12') +
            '</tr>';
        }).join('')
      : '<tr><td colspan="' + COLS_LOTES + '" style="' + tdStyle + ';color:#94a3b8">' +
        msgSemLotes + '</td></tr>';

    var totalEstoque = Number(g.totalEstoque) || 0;
    var rotuloTotais = totalEstoque > 0
      ? g.totalTingido + ' kg tingido · ' + totalEstoque + ' kg do estoque'
      : g.totalTingido + ' kg tingido';
    if (volumesGrupo > 0) rotuloTotais += ' · ' + _numeroBR(volumesGrupo) + ' volume(s)';
    var titulo = '<table style="border-collapse:collapse;width:100%;margin-bottom:6px"><tr>' +
      '<td style="vertical-align:middle">' +
        '<span style="color:#0B4576;font-size:' + (d.fonte + 2) + 'px;font-weight:bold">' + g.tipoFio + '</span>' +
        '<span style="color:#64748b;font-size:' + d.fonte + 'px">&nbsp;— ' + rotuloTotais + '</span></td>' +
      '<td style="text-align:right;vertical-align:middle">' +
        '<span style="background:#dcfce7;color:#166534;font-size:' + d.fonte + 'px;font-weight:bold;' +
        'padding:2px 8px;border-radius:5px">Mão de obra: ' + _moedaBR(g.maoObra) + '</span></td>' +
    '</tr></table>';

    var rotulo = 'margin:4px 0 2px;font-size:' + rotuloFonte + 'px;color:#475569;font-weight:bold;' +
      'text-transform:uppercase;letter-spacing:.04em';

    return '<div style="border:1px solid #cbd5e1;border-radius:6px;padding:8px 10px;margin-bottom:8px">' +
      titulo +
      '<p style="' + rotulo + '">Itens tingidos</p>' +
      '<table style="border-collapse:collapse;width:100%;margin-bottom:6px">' +
        '<thead><tr>' + thItens + '</tr></thead><tbody>' + rowsItens + '</tbody></table>' +
      '<p style="' + rotulo + '">Consumo no estoque de fio crú</p>' +
      '<table style="border-collapse:collapse;width:100%">' +
        '<thead><tr>' + thLotes + '</tr></thead><tbody>' + rowsLotes + '</tbody></table>' +
    '</div>';
  }).join('');

  // Rodapé de totais: volumes dos fios de um lado; mão de obra do outro,
  // sempre mostrando a BASE do cálculo (R$/kg × kg tingidos) — foi o que o
  // usuário pediu pra conferir o valor sem ter que refazer a conta.
  var baseMaoObra = custoMaoObra > 0
    ? '<span style="font-weight:normal;font-size:' + Math.max(d.fonte - 0.5, 8) + 'px">' +
        '(base: ' + _moedaBR(custoMaoObra) + '/kg × ' + _numeroBR(totalKgTingido) + ' kg tingidos)</span>'
    : '<span style="font-weight:normal;font-size:' + Math.max(d.fonte - 0.5, 8) + 'px">' +
        '(sem taxa de mão de obra informada)</span>';
  var totalGeralHtml = '<table style="border-collapse:collapse;width:100%;margin-top:2px"><tr>' +
    '<td style="padding:6px 10px;background:#0B4576;color:#fff;font-size:' + d.titulo + 'px;' +
      'font-weight:bold;border-radius:5px 0 0 5px;white-space:nowrap">' +
      'Total de volumes: ' + _numeroBR(totalVolumes) + '</td>' +
    '<td style="text-align:right;padding:6px 10px;background:#0B4576;color:#fff;font-size:' + d.titulo + 'px;' +
      'font-weight:bold;border-radius:0 5px 5px 0">Total geral de mão de obra: ' + _moedaBR(totalGeral) +
      ' &nbsp;' + baseMaoObra + '</td>' +
  '</tr></table>';

  // Malote: bloco próprio, em destaque. Em nota separada, os volumes dele
  // ficam num campo à parte — é a partir dele que a nota do malote é emitida
  // (por isso NÃO entram no total de volumes dos fios, acima).
  var maloteHtml = '';
  if (malote && malote.ativo) {
    var maloteTexto = malote.modo === 'volumes'
      ? '<table style="border-collapse:collapse;margin-top:4px"><tr>' +
          '<td style="' + tdStyle + ';background:#FEF3C7;font-weight:bold">Volumes do malote</td>' +
          '<td style="' + tdStyle + ';font-weight:bold">' + _numeroBR(malote.volumes) + '</td>' +
          '<td style="' + tdStyle + ';color:#92400E">nota fiscal SEPARADA, só do malote — ' +
            'não entra no total de volumes dos fios</td>' +
        '</tr></table>'
      : '<p style="margin:2px 0 0;font-size:' + d.fonte + 'px">Segue <b>junto com os fios</b> ' +
        '(mesma nota) — sem volumes separados.</p>';
    maloteHtml =
      '<div style="margin-top:8px;border:1px solid #F0C36D;background:#FFFBEB;border-radius:6px;padding:8px 10px">' +
        '<p style="margin:0;font-size:' + rotuloFonte + 'px;color:#92400E;font-weight:bold;' +
          'text-transform:uppercase;letter-spacing:.04em">MALOTE</p>' +
        maloteTexto +
      '</div>';
  }

  // CONFIG.LOGO_URL: URL externa fixa (ver Config.gs) — sem arquivo/base64
  // embutido; se o link não carregar, o PDF só fica sem a imagem (alt).
  var tituloTxt = '<h1 style="color:#0B4576;margin:0 0 3px;font-size:' + d.titulo + 'px;letter-spacing:.02em">' +
    ('CONFIRMAÇÃO DE EMBARQUE ' + (unidade || '')).trim() + '</h1>' +
    '<p style="margin:0;font-size:11px;color:#334155">Data: <b>' + dataFmt + '</b>' +
    ' &nbsp;&nbsp; Nº: <b>' + numero + '</b></p>';
  var cabecalho = '<table style="border-collapse:collapse;margin-bottom:8px"><tr>' +
    '<td style="padding:0 10px 0 0;vertical-align:middle">' +
      '<img src="' + CONFIG.LOGO_URL + '" alt="Marfim" style="height:' + d.logo + 'px;width:auto;display:block"></td>' +
    '<td style="vertical-align:middle">' + tituloTxt + '</td>' +
  '</tr></table>';

  // Observação geral (digitada na tela) — fecha o relatório, antes do rodapé.
  var observacaoHtml = observacao
    ? '<div style="margin-top:10px;border:1px solid #cbd5e1;border-radius:6px;padding:8px 10px">' +
        '<p style="margin:0 0 3px;font-size:' + rotuloFonte + 'px;color:#475569;font-weight:bold;' +
          'text-transform:uppercase;letter-spacing:.04em">Observações</p>' +
        '<p style="margin:0;font-size:' + d.fonte + 'px;white-space:pre-wrap">' + _escHtmlEmail(observacao) + '</p>' +
      '</div>'
    : '';

  return _cssPaginaRetrato() +
    '<div style="font-family:Arial,Helvetica,sans-serif;color:#1c2733">' +
    cabecalho +
    blocos +
    totalGeralHtml +
    maloteHtml +
    observacaoHtml +
    '<p style="color:#64748b;font-size:9px;margin-top:8px">Enviado automaticamente pelo sistema Marfim.</p></div>';
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
  var baselinePorLinha = {};     // __row -> novo TINGIDO_BASELINE (ver abaixo)
  var removidas = {};            // __row -> true
  var baixados = 0;
  // Tingido acumulado de cada item NESTE momento — vira o novo "ponto zero"
  // (TINGIDO_BASELINE) da linha que sobra, pra ela não continuar mostrando
  // o que já foi embarcado como se ainda estivesse pendente (ver comentário
  // abaixo, e `obterListaFioParaTingir`/`corrigirQuantidadeTingida`, em FioCru.gs).
  var tingidoPorItemAgora = _tingidoPorItem();

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
        baselinePorLinha[r.__row] = tingidoPorItemAgora[k] || 0;
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
        // Linha que sobrou (resíduo) de um item que ACABOU de ser confirmado:
        // limpa o rascunho da Confirmar Embarque (quantidade/observação) —
        // senão a próxima rodada começaria pré-preenchida com um valor da
        // rodada anterior, que não faz mais sentido pro resíduo. Limpa
        // também PRONTO_EMBARQUE: o resíduo é um saldo NOVO, ainda não
        // confirmado pelo Tingimento como pronto — senão ele reapareceria
        // direto pra expedição em Confirmar Embarque, sem ninguém ter
        // revisado esse novo saldo. E limpa VOLUMES: os volumes informados
        // eram do que JÁ FOI embarcado, não fazem sentido pro saldo que sobrou.
        if ((h === 'EMBARQUE_QTD_RASCUNHO' || h === 'EMBARQUE_OBS_RASCUNHO' ||
             h === 'PRONTO_EMBARQUE' || h === 'VOLUMES') &&
            novoSugeridoPorLinha.hasOwnProperty(r.__row)) {
          return '';
        }
        // TINGIDO_BASELINE: marca "até aqui já foi embarcado" — o "Já
        // tingido" mostrado pro usuário (ver `obterListaFioParaTingir`) passa
        // a contar só o que for tingido A PARTIR de agora pra este saldo,
        // como se fosse um item novo (mesmo sendo a mesma linha).
        if (h === 'TINGIDO_BASELINE' && baselinePorLinha.hasOwnProperty(r.__row)) {
          return baselinePorLinha[r.__row];
        }
        return r[h] == null ? '' : r[h];
      });
    });
  _prepararAbaCompra(CONFIG.SHEETS.PENDENCIA_COMPRA); // garante cabeçalho/coluna de item como texto
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
    numeros.push(_textoCelula(numEmb)); // nunca o valor cru (ver `_textoCelula`)
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
      // Nada de valor cru de célula na resposta (ver `_textoCelula`).
      item: _textoCelula(r.CORES),
      quantidade: Number(r.PESO) || 0,
      numero: _textoCelula(r.EMBARQUE),
      data: _soData(r.DATA),
      situacao: _textoCelula(r['SITUAÇÃO']).trim()
    };
  }).reverse().slice(0, limite);
  return { ok: true, linhas: linhas };
}

/**
 * Cancela um embarque confirmado (por número), desfazendo o que dá:
 *   1. Estorna o consumo de fio crú — lança no razão as baixas COMPENSATÓRIAS
 *      (negativas) exatamente das mesmas NFs, a partir do instantâneo de
 *      estorno gravado na confirmação (`_registrarEstornoEmbarque`).
 *   2. Devolve as quantidades à lista pendente de compra (soma de volta numa
 *      linha aberta do item, ou recria a linha — ver `_restaurarPendenciaCompra`).
 *      Pode ser desligado com `devolverPendencia = false`: é o caso do embarque
 *      DUPLICADO (mesma confirmação enviada duas vezes), em que a mercadoria
 *      saiu uma vez só e devolver os itens faria o sistema pedir compra à toa.
 *   3. Marca as linhas do embarque como CANCELADO (não some do histórico).
 *   4. Opcional: dispara um e-mail de cancelamento aos contatos da compra (o
 *      e-mail original não tem como ser "desenviado").
 *
 * Recusa se o embarque já chegou (mercadoria recebida no estoque) ou já foi
 * cancelado. Embarques antigos sem instantâneo: reabre a pendência a partir
 * das linhas de EMBARQUES e avisa que o crú precisa ser conferido na mão.
 */
function cancelarEmbarque(token, numero, avisarEmail, devolverPendencia) {
  var s = exigirSessao(token, [CONFIG.PAPEIS.MASTER, CONFIG.PAPEIS.ALMOX1]);
  // Padrão: devolve os itens à lista pendente (o embarque não aconteceu).
  // Quando o cancelamento é de um embarque DUPLICADO (o mesmo confirmado duas
  // vezes por engano), a mercadoria foi mesmo embarcada uma vez — devolver os
  // itens à pendência faria o sistema pedir compra de novo. Nesse caso a tela
  // manda `devolverPendencia = false`: só apaga o embarque repetido.
  var restaurarPendencia = (devolverPendencia === undefined || devolverPendencia === null)
    ? true : !!devolverPendencia;
  numero = String(numero == null ? '' : numero).trim();
  if (!numero) throw new Error('Informe o número do embarque a cancelar.');
  var alvo = _normNumero(numero);

  var sh = _aba(CONFIG.SHEETS.EMBARQUES);
  if (!sh || sh.getLastRow() < 2) throw new Error('Não há embarques lançados.');
  var vals = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var header = vals.shift().map(_norm);
  var iItem = header.indexOf('cores'); if (iItem < 0) iItem = 0;
  var iPeso = header.indexOf('peso'); if (iPeso < 0) iPeso = 1;
  var iEmb = header.indexOf('embarque'); if (iEmb < 0) iEmb = 2;
  var iSit = header.indexOf('situacao'); if (iSit < 0) iSit = 4;

  var linhasDoEmb = [];
  vals.forEach(function (row, i) {
    if (_normNumero(row[iEmb]) !== alvo) return;
    linhasDoEmb.push({ row: i + 2, item: String(row[iItem]).trim(), peso: Number(row[iPeso]) || 0, situacao: _norm(row[iSit]) });
  });
  if (!linhasDoEmb.length) throw new Error('Embarque nº ' + numero + ' não encontrado no histórico.');
  if (linhasDoEmb.every(function (l) { return l.situacao.indexOf('cancelado') !== -1; })) {
    throw new Error('Embarque nº ' + numero + ' já está cancelado.');
  }
  if (linhasDoEmb.some(function (l) { return l.situacao.indexOf('chegou') !== -1; })) {
    throw new Error('Embarque nº ' + numero + ' já chegou/foi recebido no estoque — não dá pra cancelar por aqui.');
  }

  var snap = _lerEstornoEmbarque(alvo);
  var creditosCru = (snap && snap.lotes && snap.lotes.length) ? _estornarCruEmbarque(snap.lotes, s.usuario, numero) : 0;
  var itensRestaurar = (snap && snap.itens && snap.itens.length)
    ? snap.itens
    : linhasDoEmb.map(function (l) { return { item: l.item, quantidade: l.peso }; });
  var restaurados = restaurarPendencia ? _restaurarPendenciaCompra(itensRestaurar, numero) : 0;

  linhasDoEmb.forEach(function (l) { sh.getRange(l.row, iSit + 1).setValue('CANCELADO'); });
  _marcarEstornoUsado(alvo);

  var destinatarios = 0;
  if (avisarEmail) {
    var lista = _destinatariosCompra().split(/[;,]/)
      .map(function (e) { return e.trim(); })
      .filter(function (e) { return e && e.indexOf('@') !== -1; });
    if (lista.length) {
      var unidade = CONFIG.getUnidadeInfo(s.unidade).rotulo.toUpperCase();
      MailApp.sendEmail({
        to: lista.join(','),
        subject: 'CANCELAMENTO de Embarque ' + unidade + ' nº ' + numero,
        htmlBody: _cancelamentoEmbarqueHTML(numero, itensRestaurar, unidade, s.usuario)
      });
      destinatarios = lista.length;
    }
  }
  return {
    ok: true, numero: numero, itens: linhasDoEmb.length, restaurados: restaurados,
    creditosCru: creditosCru, semInstantaneo: !snap, destinatarios: destinatarios,
    devolveuPendencia: restaurarPendencia
  };
}

/** Lê o instantâneo de estorno (mais recente, não cancelado) de um embarque. */
function _lerEstornoEmbarque(alvoNorm) {
  var sh = _aba(CONFIG.SHEETS.EMBARQUE_ESTORNO);
  if (!sh || sh.getLastRow() < 2) return null;
  var achado = null;
  lerRegistros(CONFIG.SHEETS.EMBARQUE_ESTORNO).forEach(function (r) {
    if (_normNumero(r.EMBARQUE) === alvoNorm && _norm(r.SITUACAO).indexOf('cancelado') === -1) achado = r;
  });
  if (!achado) return null;
  try { return JSON.parse(achado.DADOS_JSON); } catch (e) { return null; }
}

/** Marca o(s) instantâneo(s) daquele embarque como já usados (cancelados). */
function _marcarEstornoUsado(alvoNorm) {
  lerRegistros(CONFIG.SHEETS.EMBARQUE_ESTORNO).forEach(function (r) {
    if (_normNumero(r.EMBARQUE) === alvoNorm && _norm(r.SITUACAO).indexOf('cancelado') === -1) {
      atualizarCelula(CONFIG.SHEETS.EMBARQUE_ESTORNO, r.__row, 'SITUACAO', 'CANCELADO');
    }
  });
}

/** Lança as baixas compensatórias (negativas) no razão do fio crú, creditando
 * de volta exatamente as NFs consumidas pelo embarque. Devolve quantas linhas. */
function _estornarCruEmbarque(lotes, usuario, numero) {
  var linhas = lotes.map(function (l) {
    return [new Date(), l.tipoFio || '', l.nf, l.dataNf || '', l.item || '',
      -(Number(l.peso) || 0), '', (usuario || '') + ' (cancelamento embarque ' + numero + ')'];
  });
  if (!linhas.length) return 0;
  var sh = _prepararFioCruBaixas();
  sh.getRange(sh.getLastRow() + 1, 1, linhas.length, FIO_CRU_BAIXAS_HEADERS.length).setValues(linhas);
  return linhas.length;
}

/**
 * Devolve à lista pendente de compra as quantidades de um embarque cancelado:
 * soma numa linha ABERTA já existente do item; se não houver, cria uma linha
 * nova (re-derivando descrição/cliente/tipo de fio/data limite pelos mesmos
 * localizadores da Análise). Devolve quantos itens (distintos) foram devolvidos.
 */
function _restaurarPendenciaCompra(itensRestaurar, numero) {
  var addPorItem = {};
  (itensRestaurar || []).forEach(function (it) {
    var k = _norm(it.item);
    if (!k) return;
    addPorItem[k] = (addPorItem[k] || 0) + (Number(it.quantidade) || 0);
  });
  var chaves = Object.keys(addPorItem);
  if (!chaves.length) return 0;

  var regs = lerRegistros(CONFIG.SHEETS.PENDENCIA_COMPRA);
  var incrementadas = {};
  var linhasFinais = regs.map(function (r) {
    return RELACAO_COMPRA_HEADERS.map(function (h) {
      if (h === 'SUGERIDO') {
        var k = _norm(r.ITEM);
        if (addPorItem.hasOwnProperty(k) && !incrementadas[k] && _emAberto(r)) {
          incrementadas[k] = true;
          return (Number(r.SUGERIDO) || 0) + addPorItem[k];
        }
      }
      return r[h] == null ? '' : r[h];
    });
  });

  var novas = [];
  var faltando = chaves.filter(function (k) { return !incrementadas[k]; });
  if (faltando.length) {
    var localizarDesc = _criarLocalizadorDescricao();
    var localizarData = _criarLocalizadorDataLimite();
    var calcTing = _criarCalculadoraTingimento();
    faltando.forEach(function (k) {
      var itemTxt = '';
      (itensRestaurar || []).forEach(function (it) { if (_norm(it.item) === k && !itemTxt) itemTxt = String(it.item).trim(); });
      var d = localizarDesc(itemTxt);
      var t = calcTing(itemTxt, 0, 0, 0);
      var obj = {
        ITEM: itemTxt, DESCRICAO: d.descricao || '', CLIENTE: d.cliente || '', TIPO_FIO: t.tipoFio || '',
        SUGERIDO: addPorItem[k], DATA_LIMITE: localizarData(itemTxt) || '',
        OBS: 'Reaberto pelo cancelamento do embarque ' + numero, STATUS: 'ABERTO', GERADO_EM: new Date()
      };
      novas.push(RELACAO_COMPRA_HEADERS.map(function (h) { return obj.hasOwnProperty(h) ? obj[h] : ''; }));
    });
  }
  _prepararAbaCompra(CONFIG.SHEETS.PENDENCIA_COMPRA); // garante cabeçalho/coluna de item como texto
  reescreverAba(CONFIG.SHEETS.PENDENCIA_COMPRA, RELACAO_COMPRA_HEADERS, linhasFinais.concat(novas));
  return chaves.length;
}

/** HTML do e-mail de cancelamento de embarque. */
function _cancelamentoEmbarqueHTML(numero, itens, unidade, autor) {
  var rows = (itens || []).map(function (it) {
    return '<tr><td style="border:1px solid #cbd5e1;padding:6px 9px;font-size:13px">' + _escHtmlEmail(it.item) +
      '</td><td style="border:1px solid #cbd5e1;padding:6px 9px;font-size:13px">' + (Number(it.quantidade) || 0) + '</td></tr>';
  }).join('');
  return '<div style="font-family:Arial,Helvetica,sans-serif;color:#1c2733">' +
    '<h1 style="color:#B91C1C;margin:0 0 4px;font-size:20px">EMBARQUE CANCELADO — ' + unidade + ' nº ' + _escHtmlEmail(numero) + '</h1>' +
    '<p style="margin:0 0 12px;font-size:13px;color:#334155">Cancelado por <b>' + _escHtmlEmail(autor) + '</b>. ' +
      'Desconsiderem a confirmação anterior deste embarque — os itens abaixo voltaram para a lista pendente.</p>' +
    '<table style="border-collapse:collapse"><thead><tr>' +
      '<th style="border:1px solid #cbd5e1;padding:7px 9px;background:#B91C1C;color:#fff;text-align:left;font-size:13px">Item</th>' +
      '<th style="border:1px solid #cbd5e1;padding:7px 9px;background:#B91C1C;color:#fff;text-align:left;font-size:13px">Quantidade (kg)</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table>' +
    '<p style="color:#64748b;font-size:12px;margin-top:14px">Enviado automaticamente pelo sistema Marfim.</p></div>';
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
 * mesmo período cuja coluna NF seja o próprio número do embarque (coluna
 * EMBARQUE) — ou comece por ele seguida de texto, para tolerar um erro de
 * digitação (ver `_nfCasaComEmbarque`; NUNCA um número que só "contenha" o
 * do embarque no meio, tipo 15983512 casando com 983) — e cujo item bata —
 * se achar, marca "CHEGOU" na aba EMBARQUES (ela deixa de ser considerada em
 * viagem a partir daí).
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
 * Confere se a NF lançada no estoque é o mesmo nº de embarque — NÃO só
 * "contém" (era assim antes, e casava embarque nº 983 com uma NF qualquer
 * tipo 15983512, só porque "983" aparece no meio do número maior). Casa
 * quando o número do embarque aparece na NF como um BLOCO DE DÍGITOS
 * SEPARADO — ladeado por início/fim de texto ou por algo que não é dígito
 * (espaço, traço...) — nunca embutido dentro de outro número maior:
 *   - NF IGUAL ao número do embarque (ex.: "983"), ou
 *   - NF que COMEÇA por ele seguido de algo que não é mais um dígito (ex.:
 *     "983-A", "983 CE" — cobre o usuário que digitou um texto a mais por
 *     engano), ou
 *   - NF composta por partes separadas (ex.: "91735 983 06" — a NF real do
 *     malote/lote, onde o número do embarque é UMA das partes, não o
 *     começo da NF inteira).
 * Em todos os casos, "9834" continua sendo OUTRO número (não é "983" com
 * texto a mais), e "15983512" continua não casando (o "983" ali é parte de
 * um número maior, não um bloco separado).
 */
function _nfCasaComEmbarque(nfNorm, numEmbNorm) {
  if (!nfNorm || !numEmbNorm) return false;
  if (nfNorm === numEmbNorm) return true;
  var escapado = numEmbNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(^|\\D)' + escapado + '(\\D|$)').test(nfNorm);
}

/**
 * Confere, dentro do período informado, quais embarques pendentes já foram
 * lançados na aba ESTOQUE (NF é o próprio nº do embarque, ou começa por ele
 * seguida de texto — ver `_nfCasaComEmbarque` — + item confere) e marca
 * "CHEGOU" na aba EMBARQUES.
 *
 * Quando o casamento não é claro o bastante pra decidir sozinho, em vez de
 * arriscar (marcar chegada errada) ou ignorar (deixar de contar uma chegada
 * de verdade), a linha entra em `emDuvida` pro master decidir — mesma ideia
 * da Associação, que também pede confirmação quando não tem certeza. Dois
 * casos contam como dúvida:
 *   - a NF CONTÉM o número do embarque, mas não como bloco isolado (ex.:
 *     "983" dentro de "15983512" — o próprio caso que motivou apertar o
 *     casamento em `_nfCasaComEmbarque`; antes era descartado direto, agora
 *     vira pergunta em vez de "não é");
 *   - a NF bate (bloco isolado) com MAIS DE UM número de embarque pendente
 *     ao mesmo tempo — não dá pra saber qual dos dois é, sem chutar.
 * Não fica memorizado: cada vez que a Análise roda, os mesmos casos em
 * dúvida voltam a aparecer, até o master confirmar (`confirmarChegadaEmbarque`)
 * ou o embarque ser marcado CHEGOU de outra forma.
 *
 * Devolve { marcados, emDuvida: [{ item, nf, dataNf, candidatos:
 * [{ numero, linhas }] }] }.
 */
function _atualizarChegadasEmbarque(inicio, fim) {
  var vazio = { marcados: 0, emDuvida: [] };
  var shEmb = _aba(CONFIG.SHEETS.EMBARQUES);
  if (!shEmb) return vazio;
  var lastEmb = shEmb.getLastRow();
  if (lastEmb < 2) return vazio;

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
    pendentes[numEmb].push({ linha: i + 2, itemNorm: _norm(row[iItemEmb]), item: _itemDeCelula(row[iItemEmb]) });
  });
  var numeros = Object.keys(pendentes);
  if (!numeros.length) return vazio;

  var shEst = _aba(CONFIG.SHEETS.ESTOQUE);
  if (!shEst) return vazio;
  var lastEst = shEst.getLastRow();
  if (lastEst < 2) return vazio;
  var valsEst = shEst.getRange(1, 1, lastEst, shEst.getLastColumn()).getValues();
  var headerEst = valsEst.shift().map(_norm);
  var iItemEst = _colPorNomes(headerEst, ['item', 'descricao']);
  var iDataEst = _colPorNomes(headerEst, ['data', 'data lancamento']);
  var iNfEst = _colPorNomes(headerEst, ['nf', 'nota fiscal/pedido']);
  if (iItemEst < 0 || iDataEst < 0 || iNfEst < 0) return vazio;

  var linhasParaMarcar = {};
  var emDuvida = [];
  valsEst.forEach(function (row) {
    var data = _parseData(row[iDataEst]);
    if (!data || data.getTime() < inicio.getTime() || data.getTime() > fim.getTime()) return;
    var nf = _normNumero(row[iNfEst]);
    if (!nf) return;
    var itemNorm = _norm(row[iItemEst]);

    var estritos = [];  // bloco isolado (casamento forte, ver _nfCasaComEmbarque)
    var embutidos = []; // só "contido em algum lugar" — não isolado
    numeros.forEach(function (numEmb) {
      var pend = pendentes[numEmb].filter(function (p) { return p.itemNorm === itemNorm; });
      if (!pend.length) return;
      if (_nfCasaComEmbarque(nf, numEmb)) estritos.push({ numero: numEmb, pend: pend });
      else if (nf.indexOf(numEmb) !== -1) embutidos.push({ numero: numEmb, pend: pend });
    });

    if (estritos.length === 1) {
      estritos[0].pend.forEach(function (p) { linhasParaMarcar[p.linha] = true; });
    } else if (estritos.length > 1 || embutidos.length >= 1) {
      var fonte = estritos.length > 1 ? estritos : embutidos;
      emDuvida.push({
        item: fonte[0].pend[0].item,
        nf: _textoCelula(row[iNfEst]),
        dataNf: _soData(row[iDataEst]),
        candidatos: fonte.map(function (c) {
          return { numero: c.numero, linhas: c.pend.map(function (p) { return p.linha; }) };
        })
      });
    }
  });

  var linhas = Object.keys(linhasParaMarcar);
  linhas.forEach(function (linha) {
    shEmb.getRange(parseInt(linha, 10), iSituacao + 1).setValue('CHEGOU');
  });
  return { marcados: linhas.length, emDuvida: emDuvida };
}

/**
 * O master confirma, no painel "Chegadas a confirmar" (ver `_atualizarChegadasEmbarque`),
 * que uma NF em dúvida é de fato um certo embarque — marca "CHEGOU" nas
 * linhas informadas de EMBARQUES. Confere de novo (na hora) que cada linha
 * ainda é do embarque indicado, pra não marcar errado se a lista mudou
 * entre a Análise carregar e o master responder (ex.: outro usuário já
 * confirmou/cancelou aquele embarque nesse meio-tempo).
 * @param {Array<number>} linhas       linhas de EMBARQUES a marcar.
 * @param {string|number} numeroEmbarque  nº do embarque escolhido pelo master.
 */
function confirmarChegadaEmbarque(token, linhas, numeroEmbarque) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER]);
  linhas = (linhas || []).map(function (l) { return parseInt(l, 10); }).filter(function (l) { return l >= 2; });
  if (!linhas.length) throw new Error('Nenhuma linha informada.');
  var numNorm = _normNumero(numeroEmbarque);
  if (!numNorm) throw new Error('Número de embarque inválido.');

  var sh = _aba(CONFIG.SHEETS.EMBARQUES);
  if (!sh) throw new Error('Aba EMBARQUES não encontrada.');
  var header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(_norm);
  var iEmbarque = header.indexOf('embarque'); if (iEmbarque < 0) iEmbarque = 2;
  var iSituacao = header.indexOf('situacao'); if (iSituacao < 0) iSituacao = 4;

  var marcados = 0;
  linhas.forEach(function (linha) {
    var valorEmb = _normNumero(sh.getRange(linha, iEmbarque + 1).getValue());
    if (valorEmb !== numNorm) return; // mudou de embarque nesse meio-tempo — não arrisca
    sh.getRange(linha, iSituacao + 1).setValue('CHEGOU');
    marcados++;
  });
  if (!marcados) throw new Error('Essa chegada não está mais em aberto — a lista pode ter mudado, recarregue a tela.');
  return { ok: true, marcados: marcados };
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
    var sit = _norm(row[iSituacao]);
    if (sit.indexOf('chegou') !== -1) return;    // já chegou: não conta mais
    if (sit.indexOf('cancelado') !== -1) return; // embarque cancelado: nunca vai chegar
    var chave = _norm(item);
    mapa[chave] = (mapa[chave] || 0) + (parseFloat(row[iPeso]) || 0);
  });
  return mapa;
}

/* --------------------- previsão de chegada na filial -------------------- */
/**
 * A chegada do embarque na filial é semanal e fixa: cada empresa recebe em
 * certos DIAS DA SEMANA (ex.: só segunda; ou quarta e sexta), e existe um
 * PRAZO MÍNIMO de trânsito entre emitir o relatório de embarque e a mercadoria
 * poder chegar. A previsão é, então, o primeiro dia de recebimento que caia
 * pelo menos `prazoDias` depois da data do embarque.
 *
 * Ex. (empresa que recebe só quarta, prazo 3): embarque na sexta 24/07 →
 * 24+3 = segunda 27 → primeira quarta a partir daí = 29/07.
 * Ex. (empresa que recebe só segunda, prazo 3): embarque na quarta → +3 = sábado
 * → segunda seguinte.
 *
 * Configurado por unidade (Propriedades do script) — ver `obterConfigChegada`.
 */
var DIAS_SEMANA_ROTULO = {
  1: 'Segunda', 2: 'Terça', 3: 'Quarta', 4: 'Quinta', 5: 'Sexta', 6: 'Sábado', 7: 'Domingo'
};

/** Date → dia da semana 1..7 (1=segunda ... 7=domingo). */
function _diaSemana1a7(d) {
  var g = d.getDay(); // 0=domingo ... 6=sábado
  return g === 0 ? 7 : g;
}

/** Primeiro dia de recebimento a partir de (dataEmbarque + prazoDias). null se
 * não houver dia configurado ou a data do embarque for inválida. */
function _previsaoChegada(dataEmbarque, dias, prazoDias) {
  if (!(dataEmbarque instanceof Date) || isNaN(dataEmbarque.getTime())) return null;
  if (!dias || !dias.length) return null;
  var d = new Date(dataEmbarque.getFullYear(), dataEmbarque.getMonth(), dataEmbarque.getDate());
  d.setDate(d.getDate() + Math.max(Number(prazoDias) || 0, 0));
  for (var i = 0; i < 14; i++) { // duas semanas cobrem qualquer configuração
    if (dias.indexOf(_diaSemana1a7(d)) !== -1) return d;
    d.setDate(d.getDate() + 1);
  }
  return null;
}

/** Prazo mínimo de trânsito (dias) usado quando a unidade não configurou nada. */
var PRAZO_CHEGADA_PADRAO = 3;

/**
 * Dias de recebimento + prazo mínimo da unidade ATIVA. Leitura liberada a
 * qualquer sessão (a tela Relatório usa pra mostrar a previsão); só o master
 * altera (`salvarConfigChegada`).
 * @return {Object} { ok, dias:[1..7], prazoDias, rotulos:[...] }
 */
function obterConfigChegada(token) {
  exigirSessao(token);
  var c = _configChegadaUnidade();
  return {
    ok: true, dias: c.dias, prazoDias: c.prazoDias,
    rotulos: c.dias.map(function (n) { return DIAS_SEMANA_ROTULO[n]; })
  };
}

/** Lê a configuração de chegada da unidade ativa (uso interno). */
function _configChegadaUnidade() {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty(_propUnidade('DIAS_CHEGADA')) || '';
  var dias = raw.split(/[;,]/)
    .map(function (s) { return parseInt(s, 10); })
    .filter(function (n) { return n >= 1 && n <= 7; });
  var prazo = parseInt(props.getProperty(_propUnidade('PRAZO_CHEGADA')), 10);
  return { dias: dias, prazoDias: isNaN(prazo) ? PRAZO_CHEGADA_PADRAO : prazo };
}

/** Salva os dias de recebimento e o prazo mínimo da unidade ativa (só master). */
function salvarConfigChegada(token, dias, prazoDias) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER]);
  var lista = (Array.isArray(dias) ? dias : String(dias == null ? '' : dias).split(/[;,]/))
    .map(function (s) { return parseInt(s, 10); })
    .filter(function (n) { return n >= 1 && n <= 7; });
  var prazo = parseInt(prazoDias, 10);
  if (isNaN(prazo) || prazo < 0) prazo = PRAZO_CHEGADA_PADRAO;
  var props = PropertiesService.getScriptProperties();
  props.setProperty(_propUnidade('DIAS_CHEGADA'), lista.join(','));
  props.setProperty(_propUnidade('PRAZO_CHEGADA'), String(prazo));
  return { ok: true, dias: lista, prazoDias: prazo };
}

/**
 * Remessas ainda EM VIAGEM de cada item: normalizado(item) → lista de
 * [{ numero, data, quantidade }], da mais antiga pra mais nova.
 *
 * Ignora linhas já chegadas ou canceladas — então, quando uma remessa PARCIAL
 * é recebida (marcada "chegou"), ela sai daqui sozinha e o item fica SEM
 * previsão até entrar um novo relatório de embarque com o saldo (e assim
 * quantas vezes precisar, até fechar o pedido). Cada remessa a caminho mantém
 * a SUA data e a SUA quantidade — com dois relatórios parciais em viagem,
 * aparecem as duas datas (linhas do mesmo nº de embarque são somadas).
 *
 * Só a previsão de chegada do Relatório usa esta função; o cálculo de "em
 * viagem" da análise de compra (`_emViagemPorItem`) segue somando, como antes.
 */
function _embarquesEmViagemPorItem() {
  var sh = _aba(CONFIG.SHEETS.EMBARQUES);
  var mapa = {};
  if (!sh) return mapa;
  var last = sh.getLastRow();
  if (last < 2) return mapa;

  var vals = sh.getRange(1, 1, last, sh.getLastColumn()).getValues();
  var header = vals.shift().map(_norm);
  var iItem = header.indexOf('cores'); if (iItem < 0) iItem = 0;
  var iPeso = header.indexOf('peso'); if (iPeso < 0) iPeso = 1;
  var iEmb = header.indexOf('embarque'); if (iEmb < 0) iEmb = 2;
  var iData = header.indexOf('data'); if (iData < 0) iData = 3;
  var iSit = header.indexOf('situacao'); if (iSit < 0) iSit = 4;
  var iVol = header.indexOf('volumes'); // pode não existir em aba antiga
  var iSol = header.indexOf('solicitado_em'); // idem — coluna nova

  var porItemEmb = {}; // item -> { nºembarque -> remessa }
  vals.forEach(function (row) {
    var item = row[iItem];
    if (item === '' || item == null) return;
    var sit = _norm(row[iSit]);
    if (sit.indexOf('chegou') !== -1 || sit.indexOf('cancelado') !== -1) return;
    var chave = _norm(_itemDeCelula(item));
    var num = _normNumero(row[iEmb]) || '(sem número)';
    if (!porItemEmb[chave]) porItemEmb[chave] = {};
    var atual = porItemEmb[chave][num];
    var qtd = parseFloat(row[iPeso]) || 0;
    var data = _parseData(row[iData]);
    var vol = (iVol >= 0) ? (parseFloat(row[iVol]) || 0) : 0;
    var dataSolicitado = (iSol >= 0) ? _soData(row[iSol]) : '';
    if (!atual) {
      // `item` guarda o texto como está na aba EMBARQUES — usado pelo Relatório
      // pra montar a linha do item que já saiu da pendência mas não chegou.
      porItemEmb[chave][num] = {
        item: _itemDeCelula(item), numero: row[iEmb], data: data, quantidade: qtd, volumes: vol,
        dataSolicitado: dataSolicitado
      };
    } else {
      atual.quantidade += qtd;
      atual.volumes += vol;
      if (data && !atual.data) atual.data = data;
      if (dataSolicitado && !atual.dataSolicitado) atual.dataSolicitado = dataSolicitado;
    }
  });

  Object.keys(porItemEmb).forEach(function (chave) {
    var lista = Object.keys(porItemEmb[chave]).map(function (n) { return porItemEmb[chave][n]; });
    lista.sort(function (a, b) {
      var ta = a.data ? a.data.getTime() : Infinity; // sem data vai pro fim
      var tb = b.data ? b.data.getTime() : Infinity;
      return ta - tb;
    });
    mapa[chave] = lista;
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
      return {
        item: _textoCelula(l[0]), embarque: _textoCelula(l[1]),
        quantidade: _numeroCelula(l[2]), dataEmbarque: _soData(l[3])
      };
    })
  };
}

/** Lista a aba PENDÊNCIAS EMBARQUE (para exibir a qualquer momento, sem rodar a análise). */
function listarPendenciasEmbarque(token) {
  exigirSessao(token, [CONFIG.PAPEIS.MASTER]);
  var regs = lerRegistros(CONFIG.SHEETS.PENDENCIAS_EMBARQUE);
  var linhas = regs.map(function (r) {
    return {
      item: _textoCelula(r.ITEM),
      embarque: _textoCelula(r.EMBARQUE),
      quantidade: _numeroCelula(r.QUANTIDADE),
      dataEmbarque: _soData(r.DATA_EMBARQUE),
      observacao: _textoCelula(r.OBSERVACAO)
    };
  });
  return { ok: true, linhas: linhas };
}
